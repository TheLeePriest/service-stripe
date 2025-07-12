import type { UpdateProductProductDependencies } from "./UpdateProduct.types";
import type { PriceUpdated } from "../types/events.type";
import type { EventBridgeEvent } from "aws-lambda";
import {
  UpdateItemCommand,
  type AttributeValue,
} from "@aws-sdk/client-dynamodb";
import type { Logger } from "../types/utils.types";

const convertMetadataToAttributeMap = (metadata: {
  [key: string]: string;
}): {
  [key: string]: { S: string };
} => {
  const result: { [key: string]: { S: string } } = {};
  for (const [key, value] of Object.entries(metadata)) {
    result[key] = { S: value };
  }
  return result;
};

export const updateProduct =
  ({
    dynamoDBClient,
    stripe,
    productsTableName,
    logger,
  }: UpdateProductProductDependencies & { logger: Logger }) =>
  async (event: EventBridgeEvent<"price.updated", PriceUpdated>) => {
    const { detail } = event;
    logger.logStripeEvent("price.updated", detail as unknown as Record<string, unknown>);
    const { data: priceCreatedData } = detail;
    logger.debug("Price updated data", { priceCreatedData });
    const price = event.detail.data.object;
    const productId = price.product;

    if (!priceCreatedData) {
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
      const priceIds = productPrices.data.map((price) => price.id);
      const { metadata } = product;

      if (!product) {
        logger.warn("Missing product data, skipping", { productId });
        return;
      }

      const { licenseType } = metadata;

      const updateExpression = [
        "SET productName = :productName",
        "productDescription = :productDescription",
        "priceAmount = :priceAmount",
        "priceCurrency = :priceCurrency",
        "billingScheme = :billingScheme",
        "#interval = :interval",
        "intervalCount = :intervalCount",
        "usageType = :usageType",
        "trialPeriodDays = :trialPeriodDays",
        "active = :active",
        "metadata = :metadata",
        "updatedAt = :updatedAt",
        "priceIds = :priceIds",
        "licenseType = :licenseType",
      ];

      const expressionAttributeValues: Record<string, AttributeValue> = {
        ":productName": { S: product.name },
        ":productDescription": { S: product.description || "" },
        ":priceAmount": { N: (price.unit_amount ?? 0).toString() },
        ":priceCurrency": { S: price.currency },
        ":billingScheme": { S: price.billing_scheme },
        ":interval": { S: price.recurring?.interval ?? "" },
        ":intervalCount": {
          N: (price.recurring?.interval_count ?? 0).toString(),
        },
        ":usageType": { S: price.recurring?.usage_type ?? "" },
        ":trialPeriodDays": {
          N: (price.recurring?.trial_period_days || 0).toString(),
        },
        ":active": { BOOL: product.active && price.active },
        ":metadata": { M: convertMetadataToAttributeMap(product.metadata) },
        ":updatedAt": { S: new Date().toISOString() },
        ":priceIds": { SS: priceIds },
        ":licenseType": { S: licenseType },
      };

      await dynamoDBClient.send(
        new UpdateItemCommand({
          TableName: productsTableName,
          Key: {
            PK: { S: `PRODUCT#${productId}` },
            SK: { S: `PRICE#${price.id}` },
          },
          UpdateExpression: updateExpression.join(", "),
          ExpressionAttributeNames: {
            "#interval": "interval",
          },
          ExpressionAttributeValues: expressionAttributeValues,
          ReturnValues: "ALL_NEW",
        }),
      );

      logger.info("Product updated successfully", {
        productId: productId as string,
        productName: product.name,
        priceId: price.id,
      });
    } catch (error) {
      logger.error("Failed to update product", {
        productId: productId as string,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  };
