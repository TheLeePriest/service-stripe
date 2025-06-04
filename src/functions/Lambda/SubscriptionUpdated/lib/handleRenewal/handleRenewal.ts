import {
  type EventBridgeClient,
  PutEventsCommand,
} from "@aws-sdk/client-eventbridge";
import type { HandleRenewal } from "./handleRenewal.types";

export const handleRenewal = async ({
  subscription,
  eventBridgeClient,
  eventBusName,
}: HandleRenewal) => {
  console.log(`Handling renewal for subscription ${subscription.id}`);

  const earliestRenewalDate = Math.min(
    ...subscription.items.data.map((item) => item.current_period_start),
  );

  try {
    await eventBridgeClient.send(
      new PutEventsCommand({
        Entries: [
          {
            EventBusName: eventBusName,
            Source: "service.stripe",
            DetailType: "SubscriptionRenewed",
            Detail: JSON.stringify({
              stripeSubscriptionId: subscription.id,
              stripeCustomerId: subscription.customer,
              earliestRenewalDate: earliestRenewalDate,
              cancelAtPeriodEnd: subscription.cancel_at_period_end,
              items: subscription.items.data.map((item) => ({
                itemId: item.id,
                quantity: item.quantity,
                started: item.current_period_start,
                expiresAt: item.current_period_end,
                productId: item.price.product,
                priceId: item.price.id,
              })),
            }),
          },
        ],
      }),
    );
  } catch (err) {
    console.error(
      `Error sending SubscriptionRenewed event for subscription ${subscription.id}:`,
      err,
    );
    throw err;
  }
};
