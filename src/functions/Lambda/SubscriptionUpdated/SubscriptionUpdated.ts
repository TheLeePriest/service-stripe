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

    logger.logStripeEvent("customer.subscription.updated", event as unknown as Record<string, unknown>);

    try {
      const state = determineSubscriptionState(event);

      logger.info("Processing subscription update", {
        subscriptionId: stripeSubscriptionId,
        status,
        state,
      });

      switch (state) {
        case "QUANTITY_CHANGED": {
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
          await handleUncancellation(event, schedulerClient, logger);
          break;

        case "RENEWED":
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
          logger.info("Subscription updated", {
            subscriptionId: stripeSubscriptionId,
            status,
          });
          break;

        default: {
          const _exhaustiveCheck: never = state;
          logger.warn("Unhandled subscription state", {
            subscriptionId: stripeSubscriptionId,
            state,
          });
          return _exhaustiveCheck;
        }
      }
    } catch (error) {
      logger.error("Error processing subscription", {
        subscriptionId: stripeSubscriptionId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  };
