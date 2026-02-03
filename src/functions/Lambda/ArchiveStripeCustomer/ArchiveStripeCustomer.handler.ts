import Stripe from "stripe";
import { EventBridgeClient } from "@aws-sdk/client-eventbridge";
import { archiveStripeCustomer } from "./ArchiveStripeCustomer";
import { createStripeLogger } from "../lib/logger/createLogger";
import { env } from "../lib/env";

const eventBusName = env.get("TARGET_EVENT_BUS_NAME");

if (!eventBusName) {
  throw new Error("TARGET_EVENT_BUS_NAME environment variable is not set");
}

const stripe = new Stripe(
  env.getRequired("STRIPE_SECRET_KEY", "Stripe secret key"),
  {
    apiVersion: "2025-04-30.basil",
  }
);

const eventBridgeClient = new EventBridgeClient({});

const logger = createStripeLogger(
  "archiveStripeCustomer",
  env.getRequired("STAGE") as "dev" | "prod" | "test"
);

export const handler = archiveStripeCustomer({
  stripeClient: stripe,
  eventBridgeClient,
  eventBusName,
  logger,
});
