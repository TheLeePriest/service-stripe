import type { HandleCancellationDependencies } from "./handleCancellation.type";
import { PutEventsCommand } from "@aws-sdk/client-eventbridge";

export const handleCancellation = async ({
  subscription,
  eventBridgeClient,
  eventBusName,
}: HandleCancellationDependencies) => {
  console.log(subscription, "handleCancellation called");
  const now = Date.now();
  const { items } = subscription;
  const tasks = items.data.map(async (item) => {
    const endMs = item.current_period_end * 1000;
    if (endMs <= now) {
      console.warn(
        `Skipping ${subscription.id}/${item.id}: period end already passed`,
      );
      return Promise.resolve();
    }

    try {
      await eventBridgeClient.send(
        new PutEventsCommand({
          Entries: [
            {
              Source: "service.stripe",
              DetailType: "LicenseCancelled",
              EventBusName: eventBusName,
              Detail: JSON.stringify({
                subscriptionId: subscription.id,
                stripeCustomerId: subscription.customer,
                cancelAt: subscription.cancel_at,
              }),
            },
          ],
        }),
      );
    } catch (err) {
      console.error("Error sending LicenseCancelled event:", err);

      throw err;
    }
  });

  const results = await Promise.allSettled(tasks);
  const failures = results.filter((r) => r.status === "rejected");
  if (failures.length) {
    throw new Error(`${failures.length} subscription schedules failed`);
  }
};
