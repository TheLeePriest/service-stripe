import type {
  SubscriptionUpdatedEvent,
  SubscriptionUpdatedDependencies,
  SubscriptionState,
} from "./SubscriptionUpdated.types";
import { handleCancellation } from "./lib/handleCancellation/handleCancellation";
import { handleUncancellation } from "./lib/handleUncancellation/handleUncancellation";
import { handleQuantityChange } from "./lib/handleQuantityChange/handleQuantityChange";
import { determineSubscriptionState } from "./lib/determineSubscriptionState/determineSubscriptionState";

export const subscriptionUpdated =
  ({
    schedulerClient,
    eventBridgeClient,
    eventBusName,
    stripe,
  }: SubscriptionUpdatedDependencies) =>
  async (event: SubscriptionUpdatedEvent) => {
    const { id: stripeSubscriptionId, status } = event;

    try {
      const state = determineSubscriptionState(event);

      switch (state) {
        case "QUANTITY_CHANGED": {
          await handleQuantityChange({
            subscriptionId: event.id,
            previousAttributes: event.previousAttributes,
            subscription: event,
            eventBridgeClient,
            eventBusName,
            stripe,
          });
          break;
        }

        case "CANCELLING":
          await handleCancellation({
            subscription: event,
            eventBridgeClient,
            eventBusName,
          });
          break;

        case "UNCANCELLING":
          await handleUncancellation(event, schedulerClient);
          break;

        case "OTHER_UPDATE":
          console.log(
            `Subscription ${stripeSubscriptionId} updated with status: ${status}`,
          );
          break;

        default: {
          const _exhaustiveCheck: never = state;
          console.log(
            `Unhandled subscription state for ${stripeSubscriptionId}`,
          );
          return _exhaustiveCheck;
        }
      }
    } catch (error) {
      console.error(
        `Error processing subscription ${stripeSubscriptionId}:`,
        error,
      );
      throw error;
    }
  };
