import { EventBridgeClient } from "@aws-sdk/client-eventbridge";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { sessionEventConductor } from "./SessionEventConductor";
import { createStripeLogger } from "../lib/logger/createLogger";
import { getStripeClient } from "../lib/stripeClient";
import { env } from "../lib/env";
import type { EventBridgeEvent } from "aws-lambda";
import type Stripe from "stripe";

const eventBusName = env.get("TARGET_EVENT_BUS_NAME");
const idempotencyTableName = env.get("IDEMPOTENCY_TABLE_NAME");

if (!eventBusName) {
  throw new Error("TARGET_EVENT_BUS_NAME environment variable is not set");
}

if (!idempotencyTableName) {
  throw new Error("IDEMPOTENCY_TABLE_NAME environment variable is not set");
}

const eventBridgeClient = new EventBridgeClient({});
const dynamoDBClient = new DynamoDBClient({});

const logger = createStripeLogger(
  "sessionEventConductor",
  env.getRequired("STAGE") as "dev" | "prod" | "test"
);

let handler: ReturnType<typeof sessionEventConductor> | undefined;

export const sessionEventConductorHandler = async (
  event: EventBridgeEvent<string, Stripe.CheckoutSessionCompletedEvent>,
) => {
  if (!handler) {
    const stripe = await getStripeClient(env.getRequired("STAGE"));
    handler = sessionEventConductor({
      stripe,
      eventBridgeClient,
      eventBusName,
      logger,
      dynamoDBClient,
      idempotencyTableName,
    });
  }
  return handler(event);
};
