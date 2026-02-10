import { subscriptionPauseRequested } from "./SubscriptionPauseRequested";
import { createStripeLogger } from "../lib/logger/createLogger";
import { getStripeClient } from "../lib/stripeClient";
import { env } from "../lib/env";
import type { EventBridgeEvent } from "aws-lambda";
import type { SubscriptionPauseRequestedEvent } from "./SubscriptionPauseRequested.types";

const logger = createStripeLogger(
  "subscriptionPauseRequested",
  env.getRequired("STAGE") as "dev" | "prod" | "test",
);

let handler: ReturnType<typeof subscriptionPauseRequested> | undefined;

export const subscriptionPauseRequestedHandler = async (
  event: EventBridgeEvent<"SubscriptionPauseRequested", SubscriptionPauseRequestedEvent>,
) => {
  if (!handler) {
    const stripe = await getStripeClient(env.getRequired("STAGE"));
    handler = subscriptionPauseRequested({
      stripeClient: stripe,
      logger,
    });
  }
  return handler(event);
};
