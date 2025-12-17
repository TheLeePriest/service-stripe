import type { EventBridgeEvent } from "aws-lambda";
import { z } from "zod";
import type {
  SubscriptionPauseRequestedDependencies,
  SubscriptionPauseRequestedEvent,
} from "./SubscriptionPauseRequested.types";
import { SubscriptionPauseRequestedEventSchema } from "./SubscriptionPauseRequested.types";

export const subscriptionPauseRequested =
  (deps: SubscriptionPauseRequestedDependencies) =>
  async (
    event: EventBridgeEvent<"SubscriptionPauseRequested", SubscriptionPauseRequestedEvent>,
  ): Promise<void> => {
    const { stripeClient, logger } = deps;
    const context = { requestId: event.id, functionName: "subscriptionPauseRequested" };

    let validated: SubscriptionPauseRequestedEvent;
    try {
      validated = SubscriptionPauseRequestedEventSchema.parse(event.detail);
    } catch (error) {
      const message =
        error instanceof z.ZodError
          ? error.errors.map((e) => `${e.path.join(".")}: ${e.message}`).join(", ")
          : error instanceof Error
            ? error.message
            : String(error);
      logger.error("Invalid SubscriptionPauseRequested event", { ...context, message });
      throw new Error("Invalid SubscriptionPauseRequested event");
    }

    const stripeSubscriptionId = validated.stripeSubscriptionId;

    logger.info("Processing SubscriptionPauseRequested (cancelling trial)", {
      ...context,
      stripeSubscriptionId,
      reason: validated.reason,
    });

    const subscription = await stripeClient.subscriptions.retrieve(stripeSubscriptionId);

    // Do not cancel if it's already cancelled or not trialing (e.g. upgraded)
    if (subscription.cancel_at_period_end) {
      logger.info("Subscription already set to cancel at period end; skipping", {
        ...context,
        stripeSubscriptionId,
      });
      return;
    }

    if (subscription.status !== "trialing") {
      logger.info("Subscription not trialing; skipping cancellation", {
        ...context,
        stripeSubscriptionId,
        status: subscription.status,
      });
      return;
    }

    if (subscription.metadata?.is_upgrade === "true") {
      logger.info("Subscription marked as upgrade; skipping cancellation", {
        ...context,
        stripeSubscriptionId,
      });
      return;
    }

    // Cancel the subscription at period end (since we can't pause metered subscriptions)
    await stripeClient.subscriptions.update(stripeSubscriptionId, {
      cancel_at_period_end: true,
    });

    logger.success("Cancelled Stripe subscription at period end", {
      ...context,
      stripeSubscriptionId,
    });
  };

