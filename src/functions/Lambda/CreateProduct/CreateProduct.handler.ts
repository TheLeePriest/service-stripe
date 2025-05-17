import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { createProduct } from "./CreateProduct";
import Stripe from "stripe";

const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
const productsTableName = process.env.PRODUCTS_TABLE_NAME;

if (!productsTableName) {
	throw new Error("PRODUCTS_TABLE_NAME environment variable is not set");
}

if (!stripeSecretKey) {
	throw new Error("STRIPE_SECRET_KEY environment variable is not set");
}

const stripe = new Stripe(stripeSecretKey, {
	apiVersion: "2025-04-30.basil",
});

const dynamoDBClient = new DynamoDBClient({});

export const createProductHandler = createProduct({
	dynamoDBClient,
	stripe,
	productsTableName,
});
