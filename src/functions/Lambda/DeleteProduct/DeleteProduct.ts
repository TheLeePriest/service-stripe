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
		logger,
	}: DeleteProductDependencies) =>
	async (event: EventBridgeEvent<"price.deleted", PriceDeleted>) => {
		const { detail } = event;
		const { data: priceDeletedData } = detail;
		const price = event.detail.data.object;
		const productId = price.product;

		logger.logStripeEvent("price.deleted", detail as unknown as Record<string, unknown>);

		if (!priceDeletedData) {
			logger.warn("Missing price data, skipping", { detail });
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

			logger.info("Product updated successfully", {
				productId: productId as string,
				priceId: price.id,
			});
		} catch (error) {
			const { code, statusCode } = error as Stripe.StripeRawError;
			if (code === "resource_missing" || statusCode === 404) {
				logger.info("Product not found in Stripe", { productId });
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
					logger.info("Product not found in DynamoDB", { productId });
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
					logger.info("Usage plan deleted", { 
						usagePlanId: existingPlan.id,
						productId: productId as string,
					});
					return;
				}
				return;
			}
			logger.error("Failed to delete product", {
				productId: productId as string,
				error: error instanceof Error ? error.message : String(error),
			});
			throw error;
		}
	};
