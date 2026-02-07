import type {
  SubscriptionUpdatedEvent,
  SubscriptionUpdatedDependencies,
} from "./SubscriptionUpdated.types";
import { handleCancellation } from "./lib/handleCancellation/handleCancellation";
import { handleUncancellation } from "./lib/handleUncancellation/handleUncancellation";
import { handleQuantityChange } from "./lib/handleQuantityChange/handleQuantityChange";
import { determineSubscriptionState } from "./lib/determineSubscriptionState/determineSubscriptionState";
import { handleRenewal } from "./lib/handleRenewal/handleRenewal";
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
  }: SubscriptionUpdatedDependencies) =>
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
      subscriptionId: stripeSubscriptionId,
      status,
    });

    try {
      const state = determineSubscriptionState(event);

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
          // Note: Trial upgrades are now handled via SetupIntentSucceeded handler
          // when users go through Stripe Checkout in setup mode
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
