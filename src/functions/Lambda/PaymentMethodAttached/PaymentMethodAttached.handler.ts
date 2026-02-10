import { EventBridgeClient } from "@aws-sdk/client-eventbridge";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { paymentMethodAttached } from "./PaymentMethodAttached";
import { createStripeLogger } from "../lib/logger/createLogger";
import { getStripeClient } from "../lib/stripeClient";
import { env } from "../lib/env";
import type { EventBridgeEvent } from "aws-lambda";

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
  "paymentMethodAttached",
  env.getRequired("STAGE") as "dev" | "prod" | "test"
);

let handler: ReturnType<typeof paymentMethodAttached> | undefined;

export const paymentMethodAttachedHandler = async (
  event: EventBridgeEvent<string, unknown>,
) => {
  if (!handler) {
    const stripe = await getStripeClient(env.getRequired("STAGE"));
    handler = paymentMethodAttached({
      stripe,
      eventBridgeClient,
      dynamoDBClient,
      eventBusName,
      idempotencyTableName,
      logger,
    });
  }
  return handler(event);
};
