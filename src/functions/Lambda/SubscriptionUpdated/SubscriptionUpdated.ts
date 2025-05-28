import type Stripe from "stripe";
import type {
  SubscriptionUpdatedEvent,
  SubscriptionUpdatedDependencies,
} from "./SubscriptionUpdated.types";
import { handleCancellation } from "./lib/handleCancellation/handleCancellation";
import { handleUncancellation } from "./lib/handleUncancellation/handleUncancellation";

export const subscriptionUpdated =
  ({
    eventBusArn,
    eventBusSchedulerRoleArn,
    schedulerClient,
  }: SubscriptionUpdatedDependencies) =>
  async (event: SubscriptionUpdatedEvent) => {
    const {
      id: stripeSubscriptionId,
      status,
      cancel_at_period_end,
      cancel_at,
      previousAttributes,
    } = event;

    try {
      if (isCancellation(cancel_at_period_end, status)) {
        console.log(`Subscription ${stripeSubscriptionId} is being canceled`);
        await handleCancellation(
          event,
          schedulerClient,
          eventBusArn,
          eventBusSchedulerRoleArn,
        );
      } else if (
        isUncancellation(previousAttributes, cancel_at, cancel_at_period_end)
      ) {
        console.log(
          `Subscription ${stripeSubscriptionId} has been un-canceled`,
        );
        await handleUncancellation(event, schedulerClient);
      } else {
        console.log(
          `Subscription ${stripeSubscriptionId} updated with status: ${status}`,
        );
      }
    } catch (error) {
      console.error(
        `Error processing subscription ${stripeSubscriptionId}:`,
        error,
      );
      throw error;
    }
  };

function isCancellation(cancelAtPeriodEnd: boolean, status: string): boolean {
  return cancelAtPeriodEnd || status === "canceled";
}

function isUncancellation(
  previousAttributes: Partial<Stripe.Subscription> | undefined,
  cancelAt: number | null | undefined,
  cancelAtPeriodEnd: boolean,
): boolean {
  return (
    (previousAttributes?.cancel_at !== undefined && cancelAt == null) ||
    (previousAttributes?.cancel_at_period_end === true &&
      cancelAtPeriodEnd === false)
  );
}
