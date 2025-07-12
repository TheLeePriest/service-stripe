import { PutEventsCommand } from "@aws-sdk/client-eventbridge";
import type { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import type { SendQuantityChangeEvents } from "./sendQuantityChangeEvents.types";
import type Stripe from "stripe";
import type { Logger } from "../../../../types/utils.types";
import { ensureIdempotency, generateEventId } from "../../../../lib/idempotency";

export const sendQuantityChangeEvents = async ({
  eventBridgeClient,
  eventBusName,
  subscription,
  customer,
  item,
  quantityDifference,
  logger,
  dynamoDBClient,
  idempotencyTableName,
}: SendQuantityChangeEvents & { 
  logger: Logger;
  dynamoDBClient: DynamoDBClient;
  idempotencyTableName: string;
}) => {
  const absoluteDifference = Math.abs(quantityDifference);
  logger.info("Processing quantity change for subscription", {
    subscriptionId: subscription.id,
    itemId: item.id,
    quantityDifference,
  });
  
  try {
    const eventsToSend = [];
    
    for (let i = 0; i < absoluteDifference; i++) {
      if (quantityDifference > 0) {
        // Generate idempotency key for license creation
        const eventId = generateEventId("license-created", `${subscription.id}-${item.id}-${i}`);
        
        // Check idempotency
        const idempotencyResult = await ensureIdempotency(
          { dynamoDBClient, tableName: idempotencyTableName, logger },
          eventId,
          { 
            subscriptionId: subscription.id, 
            itemId: item.id, 
            licenseIndex: i,
            quantityDifference 
          }
        );

        if (idempotencyResult.isDuplicate) {
          logger.info("License creation already processed, skipping", { 
            subscriptionId: subscription.id,
            itemId: item.id,
            licenseIndex: i,
            eventId 
          });
          continue;
        }

        // Prepare event for batching
        eventsToSend.push({
          Source: "service.stripe",
          DetailType: "LicenseCreated",
          EventBusName: eventBusName,
          Detail: JSON.stringify({
            stripeSubscriptionId: subscription.id,
            stripeCustomerId: subscription.customer,
            customerEmail: customer.email,
            productId: item.price.product,
            productName: (item.price.product as Stripe.Product).name,
            priceId: item.price.id,
            quantity: 1,
            status: subscription.status,
            createdAt: subscription.createdAt,
            cancelAtPeriodEnd: subscription.cancel_at_period_end,
            ...(subscription.trialStart && {
              trialStart: subscription.trialStart,
            }),
            ...(subscription.trialEnd && {
              trialEnd: subscription.trialEnd,
            }),
            expiresAt: item.current_period_end,
            metadata: item.metadata,
          }),
        });
      } else {
        logger.info("Quantity decreased for item", {
          itemId: item.id,
          subscriptionId: subscription.id,
        });
      }
    }

    // Send all events in a single batch (max 10 per batch)
    if (eventsToSend.length > 0) {
      const batches = [];
      for (let i = 0; i < eventsToSend.length; i += 10) {
        batches.push(eventsToSend.slice(i, i + 10));
      }

      for (const batch of batches) {
        await eventBridgeClient.send(
          new PutEventsCommand({
            Entries: batch,
          }),
        );
      }

      logger.info("Successfully sent batch of license creation events", {
        subscriptionId: subscription.id,
        itemId: item.id,
        eventCount: eventsToSend.length,
        batchCount: Math.ceil(eventsToSend.length / 10),
      });
    }
  } catch (error) {
    logger.error("Error sending quantity change events", {
      subscriptionId: subscription.id,
      itemId: item.id,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
};
