import type { CustomerCreatedEvent, CustomerCreatedDependencies } from "./CustomerCreated.types";
import { PutEventsCommand } from "@aws-sdk/client-eventbridge";
import type { Logger } from "../types/utils.types";
import { ensureIdempotency, generateEventId } from "../lib/idempotency";

export const customerCreated =
  ({
    stripe,
    eventBridgeClient,
    eventBusName,
    dynamoDBClient,
    idempotencyTableName,
    logger,
  }: CustomerCreatedDependencies & { logger: Logger }) =>
  async (event: CustomerCreatedEvent) => {
    const { id: customerId, email, name, created } = event.data.object;

    logger.logStripeEvent("customer.created", event as unknown as Record<string, unknown>);

    // Generate idempotency key
    const eventId = generateEventId("customer-created", customerId, event.created);
    
    // Check idempotency
    const idempotencyResult = await ensureIdempotency(
      { dynamoDBClient, tableName: idempotencyTableName, logger },
      eventId,
      { 
        customerId, 
        email,
        name,
        created
      }
    );

    if (idempotencyResult.isDuplicate) {
      logger.info("Customer creation already processed, skipping", { 
        customerId,
        eventId 
      });
      return;
    }

    try {
      logger.info("Processing customer creation", {
        customerId,
        email,
        name,
      });

      // Send event to EventBridge
      await eventBridgeClient.send(
        new PutEventsCommand({
          Entries: [
            {
              Source: "service.stripe",
              DetailType: "CustomerCreated",
              EventBusName: eventBusName,
              Detail: JSON.stringify({
                stripeCustomerId: customerId,
                customerEmail: email,
                customerName: name,
                createdAt: event.created,
                customerData: {
                  id: customerId,
                  email,
                  name,
                },
              }),
            },
          ],
        }),
      );

      logger.info("CustomerCreated event sent", { 
        customerId 
      });
    } catch (error) {
      logger.error("Error processing customer creation", {
        customerId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }; 