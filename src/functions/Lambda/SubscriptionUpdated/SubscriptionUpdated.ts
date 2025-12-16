import type {
  SubscriptionUpdatedEvent,
  SubscriptionUpdatedDependencies,
} from "./SubscriptionUpdated.types";
import { handleCancellation } from "./lib/handleCancellation/handleCancellation";
import { handleUncancellation } from "./lib/handleUncancellation/handleUncancellation";
import { handleQuantityChange } from "./lib/handleQuantityChange/handleQuantityChange";
import { determineSubscriptionState } from "./lib/determineSubscriptionState/determineSubscriptionState";
import { handleRenewal } from "./lib/handleRenewal/handleRenewal";
import type { Logger } from "../types/utils.types";
import { PutEventsCommand } from "@aws-sdk/client-eventbridge";

export const subscriptionUpdated =
  ({
    eventBridgeClient,
    eventBusName,
    eventBusArn,
    eventBusSchedulerRoleArn,
    schedulerClient,
    stripe,
    logger,
    dynamoDBClient,
    idempotencyTableName,
  }: SubscriptionUpdatedDependencies & { logger: Logger }) =>
  async (event: SubscriptionUpdatedEvent) => {
    const { id: stripeSubscriptionId, status } = event;

    logger.info("SubscriptionUpdated handler invoked", {
      subscriptionId: stripeSubscriptionId,
      status,
      eventId: event.id,
      createdAt: event.createdAt,
      customer: event.customer,
    });

    logger.debug("Raw subscription event structure", {
      event: JSON.stringify(event, null, 2),
    });

    logger.logStripeEvent("customer.subscription.updated", event as unknown as Record<string, unknown>);

    try {
      const state = determineSubscriptionState(event);

      // Detect trial ending (time-based) and notify license service
      const trialEnded =
        event.previousAttributes?.status === "trialing" &&
        event.status !== "trialing";

      if (trialEnded) {
        try {
          await eventBridgeClient.send(
            new PutEventsCommand({
              Entries: [
                {
                  Source: "service.stripe",
                  DetailType: "TrialExpired",
                  EventBusName: eventBusName,
                  Detail: JSON.stringify({
                    stripeSubscriptionId,
                    customer: event.customer,
                    trialEnd: event.trialEnd || event.cancel_at || event.createdAt,
                    expirationReason: "time_limit",
                  }),
                },
              ],
            }),
          );

          logger.info("Emitted TrialExpired due to Stripe trial end", {
            subscriptionId: stripeSubscriptionId,
            customer: event.customer,
            trialEnd: event.trialEnd,
          });
        } catch (emitError) {
          logger.warn("Failed to emit TrialExpired on trial end", {
            subscriptionId: stripeSubscriptionId,
            error: emitError instanceof Error ? emitError.message : String(emitError),
          });
        }
      }

      logger.info("Determined subscription state", {
        subscriptionId: stripeSubscriptionId,
        status,
        state,
        previousAttributes: event.previousAttributes,
        currentAttributes: {
          status: event.status,
          cancelAtPeriodEnd: event.cancel_at_period_end,
          currentPeriodEnd: event.items?.data?.[0]?.current_period_end,
          currentPeriodStart: event.items?.data?.[0]?.current_period_start,
        },
      });

      switch (state) {
        case "QUANTITY_CHANGED": {
          logger.info("Processing quantity change", {
            subscriptionId: stripeSubscriptionId,
            previousQuantity: event.previousAttributes?.items?.data?.[0]?.quantity,
            currentQuantity: event.items?.data?.[0]?.quantity,
          });

          await handleQuantityChange({
            subscriptionId: event.id,
            previousAttributes: event.previousAttributes,
            subscription: event,
            eventBridgeClient,
            eventBusName,
            stripe,
            logger,
            dynamoDBClient,
            idempotencyTableName,
          });
          break;
        }

        case "CANCELLING":
          logger.info("Processing subscription cancellation", {
            subscriptionId: stripeSubscriptionId,
            cancelAtPeriodEnd: event.cancel_at_period_end,
            currentPeriodEnd: event.items?.data?.[0]?.current_period_end,
          });

          await handleCancellation({
            subscription: event,
            eventBridgeClient,
            eventBusName,
            logger,
            dynamoDBClient,
            idempotencyTableName,
          });
          break;

        case "UNCANCELLING":
          logger.info("Processing subscription uncancellation", {
            subscriptionId: stripeSubscriptionId,
            cancelAtPeriodEnd: event.cancel_at_period_end,
          });

          await handleUncancellation(event, schedulerClient, logger);
          break;

        case "RENEWED":
          logger.info("Processing subscription renewal", {
            subscriptionId: stripeSubscriptionId,
            currentPeriodEnd: event.items?.data?.[0]?.current_period_end,
            currentPeriodStart: event.items?.data?.[0]?.current_period_start,
          });

          await handleRenewal({
            subscription: event,
            eventBridgeClient,
            eventBusName,
            stripe,
            logger,
            dynamoDBClient,
            idempotencyTableName,
          });
          break;

        case "OTHER_UPDATE":
          logger.info("Subscription updated (other change)", {
            subscriptionId: stripeSubscriptionId,
            status,
            changes: {
              statusChanged: event.previousAttributes?.status !== event.status,
              cancelAtPeriodEndChanged: event.previousAttributes?.cancel_at_period_end !== event.cancel_at_period_end,
              currentPeriodEndChanged: event.previousAttributes?.items?.data?.[0]?.current_period_end !== event.items?.data?.[0]?.current_period_end,
            },
          });
          break;

        default: {
          const _exhaustiveCheck: never = state;
          logger.warn("Unhandled subscription state", {
            subscriptionId: stripeSubscriptionId,
            state,
            status,
          });
          return _exhaustiveCheck;
        }
      }

      logger.info("Successfully processed subscription update", {
        subscriptionId: stripeSubscriptionId,
        state,
        status,
      });

    } catch (error) {
      logger.error("Error processing subscription", {
        subscriptionId: stripeSubscriptionId,
        status,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      throw error;
    }
  };
