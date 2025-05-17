import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { APIGatewayClient } from "@aws-sdk/client-api-gateway";
import { deleteProduct } from "./DeleteProduct";
import Stripe from "stripe";

const stage = process.env.STAGE;
const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
const productsTableName = process.env.PRODUCTS_TABLE_NAME;
const apiId = process.env.API_ID;

if (!apiId) {
	throw new Error("API_ID environment variable is not set");
}

if (!productsTableName) {
	throw new Error("PRODUCTS_TABLE_NAME environment variable is not set");
}

if (!stripeSecretKey) {
	throw new Error("STRIPE_SECRET_KEY environment variable is not set");
}

if (!stage) {
	throw new Error("STAGE environment variable is not set");
}

const stripe = new Stripe(stripeSecretKey, {
	apiVersion: "2025-04-30.basil",
});

const dynamoDBClient = new DynamoDBClient({});
const apiGatewayClient = new APIGatewayClient();

export const deleteProductHandler = deleteProduct({
	stage,
	dynamoDBClient,
	apiGatewayClient,
	stripe,
	apiId,
	productsTableName,
});
