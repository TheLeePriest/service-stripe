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

    logger.info("Processing SubscriptionPauseRequested", {
      ...context,
      stripeSubscriptionId,
      reason: validated.reason,
    });

    const subscription = await stripeClient.subscriptions.retrieve(stripeSubscriptionId);

    // Do not pause if it's already not trialing (e.g. upgraded) or already paused.
    if (subscription.pause_collection) {
      logger.info("Subscription already paused; skipping", {
        ...context,
        stripeSubscriptionId,
      });
      return;
    }

    if (subscription.status !== "trialing") {
      logger.info("Subscription not trialing; skipping pause", {
        ...context,
        stripeSubscriptionId,
        status: subscription.status,
      });
      return;
    }

    if (subscription.metadata?.is_upgrade === "true") {
      logger.info("Subscription marked as upgrade; skipping pause", {
        ...context,
        stripeSubscriptionId,
      });
      return;
    }

    await stripeClient.subscriptions.update(stripeSubscriptionId, {
      pause_collection: { behavior: "void" },
    });

    logger.success("Paused Stripe subscription", {
      ...context,
      stripeSubscriptionId,
    });
  };

