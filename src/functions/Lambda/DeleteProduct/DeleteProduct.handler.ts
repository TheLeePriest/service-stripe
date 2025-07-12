import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { APIGatewayClient } from "@aws-sdk/client-api-gateway";
import { deleteProduct } from "./DeleteProduct";
import Stripe from "stripe";
import { createStripeLogger } from "../lib/logger/createLogger";
import { env } from "../lib/env";

const stage = env.getRequired("STAGE") as "dev" | "prod" | "test";
const stripeSecretKey = env.getRequired("STRIPE_SECRET_KEY", "Stripe secret key");
const productsTableName = env.get("PRODUCTS_TABLE_NAME");
const apiId = env.get("API_ID");

if (!apiId) {
	throw new Error("API_ID environment variable is not set");
}

if (!productsTableName) {
	throw new Error("PRODUCTS_TABLE_NAME environment variable is not set");
}

const stripe = new Stripe(stripeSecretKey, {
	apiVersion: "2025-04-30.basil",
});

const dynamoDBClient = new DynamoDBClient({});
const apiGatewayClient = new APIGatewayClient();

const logger = createStripeLogger(
  "deleteProduct",
  stage
);

export const deleteProductHandler = deleteProduct({
	stage,
	dynamoDBClient,
	apiGatewayClient,
	stripe,
	apiId,
	productsTableName,
	logger,
});
