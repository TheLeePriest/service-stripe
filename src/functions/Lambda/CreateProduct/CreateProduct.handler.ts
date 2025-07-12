import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { createProduct } from "./CreateProduct";
import Stripe from "stripe";
import { createStripeLogger } from "../lib/logger/createLogger";
import { env } from "../lib/env";

const stripeSecretKey = env.getRequired("STRIPE_SECRET_KEY", "Stripe secret key");
const productsTableName = env.get("PRODUCTS_TABLE_NAME");

if (!productsTableName) {
	throw new Error("PRODUCTS_TABLE_NAME environment variable is not set");
}

const stripe = new Stripe(stripeSecretKey, {
	apiVersion: "2025-04-30.basil",
});

const dynamoDBClient = new DynamoDBClient({});

const logger = createStripeLogger(
  "createProduct",
  env.getRequired("STAGE") as "dev" | "prod" | "test"
);

export const createProductHandler = createProduct({
	dynamoDBClient,
	stripe,
	productsTableName,
	logger,
});
