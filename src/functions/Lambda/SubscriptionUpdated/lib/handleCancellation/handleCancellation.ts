import type Stripe from "stripe";
import type { HandleCancellationDependencies } from "./handleCancellation.type";
import { PutEventsCommand } from "@aws-sdk/client-eventbridge";

export const handleCancellation = async ({
  subscription,
  eventBridgeClient,
  eventBusName,
}: HandleCancellationDependencies) => {
  console.log(`Handling cancellation for subscription ${subscription.id}`);
  const now = Date.now();

  // Check if the subscription has already ended
  const latestEndDate = Math.max(
    ...subscription.items.data.map((item) => item.current_period_end * 1000),
  );
  if (latestEndDate <= now) {
    console.warn(`Skipping ${subscription.id}: subscription has already ended`);
    return;
  }

  try {
    await eventBridgeClient.send(
      new PutEventsCommand({
        Entries: [
          {
            Source: "service.stripe",
            DetailType: "SubscriptionCancelled",
            EventBusName: eventBusName,
            Detail: JSON.stringify({
              stripeSubscriptionId: subscription.id,
              stripeCustomerId: subscription.customer,
              cancelAt: subscription.cancel_at,
              cancelAtPeriodEnd: subscription.cancel_at_period_end,
              items: subscription.items.data.map((item) => ({
                itemId: item.id,
                priceId: item.price.id,
                productId: item.price.product,
                quantity: item.quantity,
                expiresAt: item.current_period_end,
                metadata: item.metadata,
              })),
            }),
          },
        ],
      }),
    );
    console.log(
      `Sent SubscriptionCancelled event for subscription ${subscription.id}`,
    );
  } catch (err) {
    console.error(
      `Error sending SubscriptionCancelled event for subscription ${subscription.id}:`,
      err,
    );
    throw err;
  }
};
