import Stripe from "stripe";
import { EventBridgeClient } from "@aws-sdk/client-eventbridge";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { customerCreated } from "./CustomerCreated";
import { createStripeLogger } from "../lib/logger/createLogger";
import { env } from "../lib/env";

const eventBusName = env.get("TARGET_EVENT_BUS_NAME");
const idempotencyTableName = env.get("IDEMPOTENCY_TABLE_NAME");

if (!eventBusName) {
	throw new Error("TARGET_EVENT_BUS_NAME environment variable is not set");
}

if (!idempotencyTableName) {
	throw new Error("IDEMPOTENCY_TABLE_NAME environment variable is not set");
}

const stripe = new Stripe(env.getRequired("STRIPE_SECRET_KEY", "Stripe secret key"), {
	apiVersion: "2025-04-30.basil",
});
const eventBridgeClient = new EventBridgeClient({});
const dynamoDBClient = new DynamoDBClient({});

const logger = createStripeLogger(
  "customerCreated",
  env.getRequired("STAGE") as "dev" | "prod" | "test"
);

export const customerCreatedHandler = customerCreated({
	stripe,
	eventBridgeClient,
	dynamoDBClient,
	eventBusName,
	idempotencyTableName,
	logger,
}); 