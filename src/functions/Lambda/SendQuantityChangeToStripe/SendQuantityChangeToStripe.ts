import type { EventBridgeEvent } from "aws-lambda";
import type {
  LicenseQuantityChange,
  SendQuantityChangeToStripeDependencies,
} from "./SendQuantityChangeToStripe.types";
import type { Logger } from "../types/utils.types";

export const sendQuantityChangeToStripe =
  ({ stripeClient, logger }: SendQuantityChangeToStripeDependencies & { logger: Logger }) =>
  async (
    event: EventBridgeEvent<
      "LicenseCancelled" | "LicenseUncancelled",
      LicenseQuantityChange
    >,
  ) => {
    const { detail } = event;
    const quantityChangeType = event["detail-type"];
    const quantityChange = quantityChangeType === "LicenseUncancelled" ? 1 : -1;
    const { itemId, stripeSubscriptionId } = detail;
    
    logger.info("Processing license quantity change event", {
      eventType: quantityChangeType,
      detail,
    });

    try {
      const subscription =
        await stripeClient.subscriptions.retrieve(stripeSubscriptionId);
      logger.debug("Retrieved subscription", { subscription });
      const subscriptionQuantity = subscription.items.data.find(
        (item) => item.id === itemId,
      )?.quantity;

      if (subscriptionQuantity === undefined) {
        throw new Error(
          `Subscription item with id ${itemId} not found or quantity is undefined`,
        );
      }
      logger.info("Current quantity for item", {
        itemId,
        currentQuantity: subscriptionQuantity,
      });
      
      await stripeClient.subscriptions.update(stripeSubscriptionId, {
        items: [
          {
            id: itemId,
            quantity: subscriptionQuantity + quantityChange,
          },
        ],
      }, {
        idempotencyKey: `quantity-change-${stripeSubscriptionId}-${itemId}-${Date.now()}`,
      });

      logger.info("Successfully updated subscription quantity", {
        itemId,
        stripeSubscriptionId,
        newQuantity: subscriptionQuantity + quantityChange,
        changeType: quantityChangeType,
      });
    } catch (error) {
      logger.error("Error processing license quantity change", { 
        eventType: quantityChangeType,
        error: error instanceof Error ? error.message : String(error),
        itemId,
        stripeSubscriptionId,
      });
      throw new Error(`Failed to process ${quantityChangeType}`);
    }
  };
