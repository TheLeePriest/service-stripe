import { EventBridgeClient } from "@aws-sdk/client-eventbridge";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { invoicePaymentSucceeded } from "./InvoicePaymentSucceeded";
import { createStripeLogger } from "../lib/logger/createLogger";
import { getStripeClient } from "../lib/stripeClient";
import { env } from "../lib/env";
import type { EventBridgeEvent } from "aws-lambda";

const eventBusName = env.get("TARGET_EVENT_BUS_NAME");
const idempotencyTableName = env.get("IDEMPOTENCY_TABLE_NAME");
const siteUrl = env.get("SITE_URL") || "https://cdkinsights.dev";

if (!eventBusName) {
	throw new Error("TARGET_EVENT_BUS_NAME environment variable is not set");
}

if (!idempotencyTableName) {
	throw new Error("IDEMPOTENCY_TABLE_NAME environment variable is not set");
}

const eventBridgeClient = new EventBridgeClient({});
const dynamoDBClient = new DynamoDBClient({});

const logger = createStripeLogger(
  "invoicePaymentSucceeded",
  env.getRequired("STAGE") as "dev" | "prod" | "test"
);

let handler: ReturnType<typeof invoicePaymentSucceeded> | undefined;

export const invoicePaymentSucceededHandler = async (
  event: EventBridgeEvent<string, unknown>,
) => {
  if (!handler) {
    const stripe = await getStripeClient(env.getRequired("STAGE"));
    handler = invoicePaymentSucceeded({
      stripe,
      eventBridgeClient,
      dynamoDBClient,
      eventBusName,
      idempotencyTableName,
      siteUrl,
      logger,
    });
  }
  return handler(event);
};
