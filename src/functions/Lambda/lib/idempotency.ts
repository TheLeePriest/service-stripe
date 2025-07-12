import type { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { PutItemCommand, GetItemCommand, BatchGetItemCommand, BatchWriteItemCommand } from "@aws-sdk/client-dynamodb";
import type { Logger } from "../types/utils.types";

export interface IdempotencyConfig {
  dynamoDBClient: DynamoDBClient;
  tableName: string;
  logger: Logger;
}

export interface IdempotencyResult {
  isDuplicate: boolean;
  existingData?: Record<string, unknown>;
}

/**
 * Ensures idempotency for event processing using DynamoDB
 * Optimized to reduce individual API calls
 * @param config - Idempotency configuration
 * @param eventId - Unique identifier for the event (e.g., "subscription-created-sub_123-1234567890")
 * @param eventData - Data to store if this is a new event
 * @param ttlSeconds - TTL in seconds (default: 24 hours)
 * @returns Promise<IdempotencyResult>
 */
export async function ensureIdempotency(
  config: IdempotencyConfig,
  eventId: string,
  eventData?: Record<string, unknown>,
  ttlSeconds = 86400 // 24 hours
): Promise<IdempotencyResult> {
  const { dynamoDBClient, tableName, logger } = config;
  const now = Math.floor(Date.now() / 1000);
  const ttl = now + ttlSeconds;

  try {
    // Use conditional PutItem instead of GetItem + PutItem to reduce API calls
    await dynamoDBClient.send(
      new PutItemCommand({
        TableName: tableName,
        Item: {
          PK: { S: eventId },
          processedAt: { N: now.toString() },
          ttl: { N: ttl.toString() },
          ...(eventData && { data: { S: JSON.stringify(eventData) } }),
        },
        ConditionExpression: "attribute_not_exists(PK)",
      })
    );

    logger.info("Event marked as processed", { eventId });
    return { isDuplicate: false };

  } catch (error) {
    // If condition check fails, event was already processed
    if (error instanceof Error && error.name === "ConditionalCheckFailedException") {
      logger.info("Event already processed (race condition)", { eventId });
      return { isDuplicate: true };
    }

    logger.error("Error checking idempotency", {
      eventId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Batch check multiple events for idempotency
 * @param config - Idempotency configuration
 * @param eventIds - Array of event IDs to check
 * @returns Promise<Map<string, IdempotencyResult>>
 */
export async function batchCheckIdempotency(
  config: IdempotencyConfig,
  eventIds: string[]
): Promise<Map<string, IdempotencyResult>> {
  const { dynamoDBClient, tableName, logger } = config;
  const results = new Map<string, IdempotencyResult>();

  if (eventIds.length === 0) {
    return results;
  }

  // Split into batches of 100 (DynamoDB limit)
  const batches = [];
  for (let i = 0; i < eventIds.length; i += 100) {
    batches.push(eventIds.slice(i, i + 100));
  }

  for (const batch of batches) {
    try {
      const keys = batch.map(eventId => ({ PK: { S: eventId } }));
      
      const response = await dynamoDBClient.send(
        new BatchGetItemCommand({
          RequestItems: {
            [tableName]: {
              Keys: keys,
              AttributesToGet: ["PK", "data", "processedAt"]
            }
          }
        })
      );

      const items = response.Responses?.[tableName] || [];
      const existingItems = new Map(
        items.map(item => [item.PK?.S, item])
      );

      for (const eventId of batch) {
        const existingItem = existingItems.get(eventId);
        if (existingItem) {
          results.set(eventId, {
            isDuplicate: true,
            existingData: existingItem.data?.S ? JSON.parse(existingItem.data.S) : undefined,
          });
        } else {
          results.set(eventId, { isDuplicate: false });
        }
      }
    } catch (error) {
      logger.error("Error in batch idempotency check", {
        batchSize: batch.length,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  return results;
}

/**
 * Generate a unique event ID for idempotency tracking
 * @param eventType - Type of event (e.g., "subscription-created")
 * @param stripeId - Stripe resource ID (e.g., subscription ID)
 * @param timestamp - Event timestamp (optional, defaults to current time)
 * @returns string
 */
export function generateEventId(
  eventType: string,
  stripeId: string,
  timestamp?: number
): string {
  const ts = timestamp || Math.floor(Date.now() / 1000);
  return `${eventType}-${stripeId}-${ts}`;
} 