import {
  type EventBridgeClient,
  PutEventsCommand,
} from "@aws-sdk/client-eventbridge";
import type { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import type { HandleCancellationDependencies } from "./handleCancellation.type";
import type { Logger } from "../../../types/utils.types";
import { ensureIdempotency, generateEventId } from "../../../lib/idempotency";
import type Stripe from "stripe";

export const handleCancellation = async ({
  subscription,
  eventBridgeClient,
  eventBusName,
  logger,
  dynamoDBClient,
  idempotencyTableName,
}: HandleCancellationDependencies & { 
  logger: Logger;
  dynamoDBClient: DynamoDBClient;
  idempotencyTableName: string;
}) => {
  logger.info("Handling cancellation for subscription", { subscriptionId: subscription.id });

  // Check if all items are in the past
  const now = Math.floor(Date.now() / 1000);
  const allItemsInPast = subscription.items.data.every(
    (item) => item.current_period_end < now
  );

  if (allItemsInPast) {
    logger.warn("Skipping subscription cancellation, subscription has already ended", {
      subscriptionId: subscription.id,
    });
    return;
  }

  // Generate idempotency key for cancellation
  const eventId = generateEventId("subscription-cancelled", subscription.id);
  
  // Check idempotency
  const idempotencyResult = await ensureIdempotency(
    { dynamoDBClient, tableName: idempotencyTableName, logger },
    eventId,
    { 
      subscriptionId: subscription.id, 
      customerId: subscription.customer,
      cancelAt: subscription.cancel_at,
      cancelAtPeriodEnd: subscription.cancel_at_period_end
    }
  );

  if (idempotencyResult.isDuplicate) {
    logger.info("Subscription cancellation already processed, skipping", { 
      subscriptionId: subscription.id,
      eventId 
    });
    return;
  }

  try {
    await eventBridgeClient.send(
      new PutEventsCommand({
        Entries: [
          {
            Source: "service.stripe",
            DetailType: "SubscriptionCancelled",
            EventBusName: eventBusName,
            Detail: JSON.stringify({
              stripeSubscriptionId: subscription.id,
              stripeCustomerId: subscription.customer,
              cancelAt: subscription.cancel_at,
              cancelAtPeriodEnd: subscription.cancel_at_period_end,
              items: subscription.items.data.map((item) => ({
                itemId: item.id,
                priceId: item.price.id,
                productId: item.price.product,
                quantity: item.quantity,
                expiresAt: item.current_period_end,
                metadata: item.metadata,
              })),
            }),
          },
        ],
      }),
    );
    logger.info("Sent SubscriptionCancelled event", { subscriptionId: subscription.id });
  } catch (err) {
    logger.error("Error sending SubscriptionCancelled event", { 
      subscriptionId: subscription.id,
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
};
