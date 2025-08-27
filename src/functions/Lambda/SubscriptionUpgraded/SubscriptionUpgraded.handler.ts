import Stripe from "stripe";
import { EventBridgeClient } from "@aws-sdk/client-eventbridge";
import { subscriptionUpgraded } from "./SubscriptionUpgraded";
import { createStripeLogger } from "../lib/logger/createLogger";
import { env } from "../lib/env";

const eventBusName = env.get("TARGET_EVENT_BUS_NAME");

if (!eventBusName) {
  throw new Error("TARGET_EVENT_BUS_NAME environment variable is not set");
}

const stripe = new Stripe(env.getRequired("STRIPE_SECRET_KEY", "Stripe secret key"), {
  apiVersion: "2025-04-30.basil",
});

const eventBridgeClient = new EventBridgeClient();

const logger = createStripeLogger(
  "subscriptionUpgraded",
  env.getRequired("STAGE") as "dev" | "prod" | "test"
);

export const subscriptionUpgradedHandler = subscriptionUpgraded({
  stripe,
  eventBridgeClient,
  eventBusName,
  logger,
});
