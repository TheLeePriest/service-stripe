import Stripe from "stripe";
import { v4 as uuidv4 } from "uuid";
import { EventBridgeClient } from "@aws-sdk/client-eventbridge";
import { subscriptionEventConductor } from "./SubscriptionEventConductor";
import { SchedulerClient } from "@aws-sdk/client-scheduler";
import { createStripeLogger } from "../lib/logger/createLogger";
import { env } from "../lib/env";

const eventBusName = env.get("TARGET_EVENT_BUS_NAME");
const eventBusSchedulerRoleArn = env.get("SCHEDULER_ROLE_ARN");
const eventBusArn = env.get("EVENT_BUS_ARN");

if (!eventBusArn) {
  throw new Error("EVENT_BUS_ARN environment variable is not set");
}

if (!eventBusSchedulerRoleArn) {
  throw new Error("SCHEDULER_ROLE_ARN environment variable is not set");
}

if (!eventBusName) {
  throw new Error("TARGET_EVENT_BUS_NAME environment variable is not set");
}

const stripe = new Stripe(env.getRequired("STRIPE_SECRET_KEY", "Stripe secret key"), {
  apiVersion: "2025-04-30.basil",
});

const eventBridgeClient = new EventBridgeClient();
const schedulerClient = new SchedulerClient();

const logger = createStripeLogger(
  "subscriptionEventConductor",
  env.getRequired("STAGE") as "dev" | "prod" | "test"
);

export const subscriptionEventConductorHandler = subscriptionEventConductor({
  stripe,
  eventBridgeClient,
  uuidv4,
  eventBusName,
  eventBusSchedulerRoleArn,
  eventBusArn,
  schedulerClient,
  logger,
});
