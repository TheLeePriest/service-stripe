import type { CreateProductDependencies } from "./CreateProduct.types";
import type { PriceCreated } from "../types/events.type";
import type { EventBridgeEvent } from "aws-lambda";
import { PutItemCommand } from "@aws-sdk/client-dynamodb";

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

export const createProduct =
  ({ dynamoDBClient, stripe, productsTableName }: CreateProductDependencies) =>
  async (event: EventBridgeEvent<"price.created", PriceCreated>) => {
    const { detail } = event;
    console.log(detail, "Received price.created event");
    const { data: priceCreatedData } = detail;
    console.log(priceCreatedData, "Price created data");
    const price = event.detail.data.object;
    const productId = price.product;

    if (!priceCreatedData) {
      console.warn("Missing price data, skipping");
      return;
    }

    const product = await stripe.products.retrieve(productId as string);
    const productPrices = await stripe.prices.list({
      product: productId as string,
      active: true,
      expand: ["data.product"],
    });
    const priceIds = productPrices.data.map((price) => price.id);
    const { metadata } = product;

    if (!product) {
      console.warn("Missing product data, skipping");
      return;
    }

    const { licenseType } = metadata;
    const now = new Date().toISOString();

    await dynamoDBClient.send(
      new PutItemCommand({
        TableName: productsTableName,
        Item: {
          PK: { S: productId as string },
          productName: { S: product.name },
          productDescription: { S: product.description || "" },
          priceAmount: { N: (price.unit_amount ?? 0).toString() },
          priceCurrency: { S: price.currency },
          billingScheme: { S: price.billing_scheme },
          interval: { S: price.recurring?.interval ?? "" },
          intervalCount: {
            N: (price.recurring?.interval_count ?? 0).toString(),
          },
          usageType: { S: price.recurring?.usage_type ?? "" },
          trialPeriodDays: {
            N: (price.recurring?.trial_period_days || 0).toString(),
          },
          active: { BOOL: product.active && price.active },
          metadata: { M: convertMetadataToAttributeMap(product.metadata) },
          updatedAt: { S: now },
          priceIds: { SS: priceIds },
          licenseType: { S: licenseType },
        },
        ConditionExpression:
          "attribute_not_exists(PK) OR #updatedAt < :updatedAt",
        ExpressionAttributeNames: {
          "#updatedAt": "updatedAt",
        },
        ExpressionAttributeValues: {
          ":updatedAt": { S: now },
        },
      }),
    );
  };
