import type { EventBridgeEvent } from "aws-lambda";
import type {
  LicenseQuantityChange,
  SendQuantityChangeToStripeDependencies,
} from "./SendQuantityChangeToStripe.types";

export const sendQuantityChangeToStripe =
  ({ stripeClient }: SendQuantityChangeToStripeDependencies) =>
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
    console.log(
      `${quantityChangeType} event for license with details:`,
      detail,
    );

    try {
      const subscription =
        await stripeClient.subscriptions.retrieve(stripeSubscriptionId);
      console.log(JSON.stringify(subscription), "Retrieved subscription");
      const subscriptionQuantity = subscription.items.data.find(
        (item) => item.id === itemId,
      )?.quantity;

      if (subscriptionQuantity === undefined) {
        throw new Error(
          `Subscription item with id ${itemId} not found or quantity is undefined`,
        );
      }
      console.log(
        `Current quantity for item ${itemId} is ${subscriptionQuantity}`,
      );
      await stripeClient.subscriptions.update(stripeSubscriptionId, {
        items: [
          {
            id: itemId,
            quantity: subscriptionQuantity + quantityChange,
          },
        ],
      });
    } catch (error) {
      console.log(`Error processing ${quantityChangeType}:`, error);
      throw new Error(`Failed to process ${quantityChangeType}`);
    }
  };
