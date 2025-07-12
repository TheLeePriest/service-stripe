import Stripe from "stripe";
import { EventBridgeClient } from "@aws-sdk/client-eventbridge";
import { sessionEventConductor } from "./SessionEventConductor";
import { createStripeLogger } from "../lib/logger/createLogger";
import { env } from "../lib/env";

const eventBusName = env.get("TARGET_EVENT_BUS_NAME");

if (!eventBusName) {
  throw new Error("TARGET_EVENT_BUS_NAME environment variable is not set");
}

const stripe = new Stripe(env.getRequired("STRIPE_SECRET_KEY", "Stripe secret key"), {
  apiVersion: "2025-04-30.basil",
});

const eventBridgeClient = new EventBridgeClient({});

const logger = createStripeLogger(
  "sessionEventConductor",
  env.getRequired("STAGE") as "dev" | "prod" | "test"
);

export const sessionEventConductorHandler = sessionEventConductor({
  stripe,
  eventBridgeClient,
  eventBusName,
  logger,
});
