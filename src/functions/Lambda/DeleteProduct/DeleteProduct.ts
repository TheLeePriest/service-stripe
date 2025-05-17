import type { DeleteProductDependencies } from "./DeleteProduct.types";
import type { PriceDeleted } from "../types/events.type";
import type { EventBridgeEvent } from "aws-lambda";
import {
	DeleteUsagePlanCommand,
	GetUsagePlansCommand,
	type GetUsagePlansCommandOutput,
	UpdateUsagePlanCommand,
} from "@aws-sdk/client-api-gateway";
import {
	DeleteItemCommand,
	QueryCommand,
	type QueryCommandOutput,
	UpdateItemCommand,
} from "@aws-sdk/client-dynamodb";
import type Stripe from "stripe";
import type { AttributeValue } from "@aws-sdk/client-dynamodb";

export const deleteProduct =
	({
		stage,
		dynamoDBClient,
		apiGatewayClient,
		stripe,
		apiId,
		productsTableName,
	}: DeleteProductDependencies) =>
	async (event: EventBridgeEvent<"price.deleted", PriceDeleted>) => {
		const { detail } = event;
		const { data: priceDeletedData } = detail;
		const price = event.detail.data.object;
		const productId = price.product;

		if (!priceDeletedData) {
			console.warn("Missing price data, skipping");
			return;
		}

		try {
			const product = await stripe.products.retrieve(productId as string);
			const productPrices = await stripe.prices.list({
				product: productId as string,
				active: true,
				expand: ["data.product"],
			});
			const priceIds = productPrices.data
				.map((price) => price.id)
				.filter((id) => id !== price.id);

			const updateExpression = [
				"active = :active",
				"updatedAt = :updatedAt",
				"priceIds = :priceIds",
			];

			const expressionAttributeValues: Record<string, AttributeValue> = {
				":active": { BOOL: product.active && price.active },
				":updatedAt": { S: new Date().toISOString() },
				":priceIds": { SS: priceIds },
			};
			await dynamoDBClient.send(
				new UpdateItemCommand({
					TableName: productsTableName,
					Key: {
						PK: { S: `PRODUCT#${productId}` },
						SK: { S: `PRICE#${price.id}` },
					},
					UpdateExpression: updateExpression.join(", "),
					ExpressionAttributeValues: expressionAttributeValues,
					ReturnValues: "ALL_NEW",
				}),
			);
		} catch (error) {
			const { code, statusCode } = error as Stripe.StripeRawError;
			if (code === "resource_missing" || statusCode === 404) {
				console.log("Product not found in Stripe:", productId);
				const productItemResponse = (await dynamoDBClient.send(
					new QueryCommand({
						TableName: productsTableName,
						KeyConditionExpression: "PK = :PK",
						ExpressionAttributeValues: {
							":PK": { S: `PRODUCT#${productId}` },
						},
					}),
				)) as QueryCommandOutput;

				const productItems = productItemResponse.Items;
				if (!productItems || productItems.length === 0) {
					console.log("Product not found in DynamoDB:", productId);
					return;
				}
				const productItem = productItems[0];

				await dynamoDBClient.send(
					new DeleteItemCommand({
						TableName: productsTableName,
						Key: {
							PK: { S: `PRODUCT#${productId}` },
							SK: { S: `PRICE#${price.id}` },
						},
					}),
				);

				const usagePlansResponse = (await apiGatewayClient.send(
					new GetUsagePlansCommand({}),
				)) as GetUsagePlansCommandOutput;

				const existingPlan = usagePlansResponse.items?.find(
					(plan) => plan.name === productItem.usagePlanName?.S,
				);

				if (existingPlan) {
					await apiGatewayClient.send(
						new UpdateUsagePlanCommand({
							usagePlanId: productItem.usagePlanId?.S as string,
							patchOperations: [
								{
									op: "remove",
									path: "/apiStages",
									value: `${apiId}:${stage}`,
								},
							],
						}),
					);

					await apiGatewayClient.send(
						new DeleteUsagePlanCommand({
							usagePlanId: productItem.usagePlanId?.S as string,
						}),
					);
					console.log("Usage plan deleted:", existingPlan.id);
					return;
				}
				return;
			}
		}
	};
