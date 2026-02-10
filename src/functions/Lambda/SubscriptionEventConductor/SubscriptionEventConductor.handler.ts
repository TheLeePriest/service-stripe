import { EventBridgeClient } from "@aws-sdk/client-eventbridge";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { subscriptionEventConductor } from "./SubscriptionEventConductor";
import { SchedulerClient } from "@aws-sdk/client-scheduler";
import { createStripeLogger } from "../lib/logger/createLogger";
import { getStripeClient } from "../lib/stripeClient";
import { env } from "../lib/env";
import type { EventBridgeEvent } from "aws-lambda";
import type { Stripe } from "stripe";

const eventBusName = env.get("TARGET_EVENT_BUS_NAME");
const eventBusSchedulerRoleArn = env.get("SCHEDULER_ROLE_ARN");
const eventBusArn = env.get("EVENT_BUS_ARN");
const idempotencyTableName = env.get("IDEMPOTENCY_TABLE_NAME");
const siteUrl = env.get("SITE_URL") || "https://cdkinsights.dev";

if (!eventBusArn) {
  throw new Error("EVENT_BUS_ARN environment variable is not set");
}

if (!eventBusSchedulerRoleArn) {
  throw new Error("SCHEDULER_ROLE_ARN environment variable is not set");
}

if (!eventBusName) {
  throw new Error("TARGET_EVENT_BUS_NAME environment variable is not set");
}

if (!idempotencyTableName) {
  throw new Error("IDEMPOTENCY_TABLE_NAME environment variable is not set");
}

const eventBridgeClient = new EventBridgeClient();
const schedulerClient = new SchedulerClient();
const dynamoDBClient = new DynamoDBClient();

const logger = createStripeLogger(
  "subscriptionEventConductor",
  env.getRequired("STAGE") as "dev" | "prod" | "test"
);

let handler: ReturnType<typeof subscriptionEventConductor> | undefined;

export const subscriptionEventConductorHandler = async (
  event: EventBridgeEvent<string, Stripe.Event>,
) => {
  if (!handler) {
    const stripe = await getStripeClient(env.getRequired("STAGE"));
    handler = subscriptionEventConductor({
      stripe,
      eventBridgeClient,
      eventBusName,
      eventBusSchedulerRoleArn,
      eventBusArn,
      schedulerClient,
      dynamoDBClient,
      idempotencyTableName,
      siteUrl,
      logger,
    });
  }
  return handler(event);
};
