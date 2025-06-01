import { PutEventsCommand } from "@aws-sdk/client-eventbridge";
import type { SendQuantityChangeEvents } from "./sendQuantityChangeEvents.types";
import type Stripe from "stripe";

export const sendQuantityChangeEvents = async ({
  eventBridgeClient,
  eventBusName,
  subscription,
  customer,
  item,
  quantityDifference,
}: SendQuantityChangeEvents) => {
  const absoluteDifference = Math.abs(quantityDifference);
  console.log(
    "Processing quantity change for subscription:",
    subscription.id,
    "item:",
    item.id,
    "quantity difference:",
    quantityDifference,
  );
  try {
    for (let i = 0; i < absoluteDifference; i++) {
      if (quantityDifference > 0) {
        await eventBridgeClient.send(
          new PutEventsCommand({
            Entries: [
              {
                Source: "service.stripe",
                DetailType: "LicenseCreated",
                EventBusName: eventBusName,
                Detail: JSON.stringify({
                  stripeSubscriptionId: subscription.id,
                  stripeCustomerId: subscription.customer,
                  customerEmail: customer.email,
                  productId: item.price.product,
                  productName: (item.price.product as Stripe.Product).name,
                  priceId: item.price.id,
                  quantity: 1,
                  status: subscription.status,
                  createdAt: subscription.createdAt,
                  cancelAtPeriodEnd: subscription.cancel_at_period_end,
                  ...(subscription.trialStart && {
                    trialStart: subscription.trialStart,
                  }),
                  ...(subscription.trialEnd && {
                    trialEnd: subscription.trialEnd,
                  }),
                  expiresAt: item.current_period_end,
                  metadata: item.metadata,
                }),
              },
            ],
          }),
        );
      } else {
        console.log(
          `Quantity decreased for item ${item.id} in subscription ${subscription.id}`,
        );
      }
    }
  } catch (error) {
    console.error(
      `Error sending quantity change events for subscription ${subscription.id}, item ${item.id}:`,
      error,
    );
    throw error;
  }
};
