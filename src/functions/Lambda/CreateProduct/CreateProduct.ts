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
  ({ dynamoDBClient, stripe, productsTableName, logger }: CreateProductDependencies) =>
  async (event: EventBridgeEvent<"price.created", PriceCreated>) => {
    const { detail } = event;
    logger.logStripeEvent("price.created", detail as unknown as Record<string, unknown>);
    
    const { data: priceCreatedData } = detail;
    logger.debug("Price created data", { priceCreatedData });
    
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
      
      // Enhanced feature metadata extraction
      const featureMetadata = {
        licenseType: metadata.licenseType || 'STANDARD',
        tier: metadata.tier || 'free',
        features: metadata.features || '{}', // JSON string of enabled features
        maxUsage: metadata.maxUsage || '1000',
        maxFingerprints: metadata.maxFingerprints || '5',
        maxTeamMembers: metadata.maxTeamMembers || '1',
        aiQuota: metadata.aiQuota || '100',
        githubIntegration: metadata.githubIntegration === 'true',
        prioritySupport: metadata.prioritySupport === 'true',
        customRules: metadata.customRules === 'true',
        advancedFormats: metadata.advancedFormats === 'true',
        ciCdIntegration: metadata.ciCdIntegration === 'true',
        trialDays: metadata.trialDays || '0',
        upgradePath: metadata.upgradePath || '',
        restrictions: metadata.restrictions || '{}', // JSON string of restrictions
      };

      const now = new Date().toISOString();

      logger.info("Product created", {
        productId: productId as string,
        productName: product.name,
        priceIds,
        licenseType,
        tier: featureMetadata.tier,
        features: featureMetadata.features,
      });

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
            // Enhanced feature metadata
            tier: { S: featureMetadata.tier },
            features: { S: featureMetadata.features },
            maxUsage: { S: featureMetadata.maxUsage },
            maxFingerprints: { S: featureMetadata.maxFingerprints },
            maxTeamMembers: { S: featureMetadata.maxTeamMembers },
            aiQuota: { S: featureMetadata.aiQuota },
            githubIntegration: { BOOL: featureMetadata.githubIntegration },
            prioritySupport: { BOOL: featureMetadata.prioritySupport },
            customRules: { BOOL: featureMetadata.customRules },
            advancedFormats: { BOOL: featureMetadata.advancedFormats },
            ciCdIntegration: { BOOL: featureMetadata.ciCdIntegration },
            trialDays: { S: featureMetadata.trialDays },
            upgradePath: { S: featureMetadata.upgradePath },
            restrictions: { S: featureMetadata.restrictions },
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

      logger.info("Product created successfully", {
        productId: productId as string,
        productName: product.name,
      });
    } catch (error) {
      logger.error("Failed to create product", {
        productId: productId as string,
        operation: "createProduct",
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  };
