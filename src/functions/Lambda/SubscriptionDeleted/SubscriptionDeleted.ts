import type Stripe from "stripe";
import { PutEventsCommand } from "@aws-sdk/client-eventbridge";
import type { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import type {
  SubscriptionDeletedDependencies,
  SubscriptionDeletedEvent,
} from "./SubscriptionDeleted.types";
import type { Logger } from "../types/utils.types";
import { ensureIdempotency, generateEventId } from "../lib/idempotency";

export const subscriptionDeleted =
  ({
    stripe,
    eventBridgeClient,
    eventBusName,
    logger,
    dynamoDBClient,
    idempotencyTableName,
  }: SubscriptionDeletedDependencies & { 
    logger: Logger;
    dynamoDBClient: DynamoDBClient;
    idempotencyTableName: string;
  }) =>
  async (event: SubscriptionDeletedEvent) => {
    const {
      id: stripeSubscriptionId,
      status,
      ended_at,
      canceled_at,
      customer,
    } = event;
    
    logger.logStripeEvent("customer.subscription.deleted", event as unknown as Record<string, unknown>);
    logger.debug("Received subscriptionDeleted event", { event });
    
    try {
      const stripeCustomer = (await stripe.customers.retrieve(
        customer as string,
      )) as Stripe.Customer;
      logger.debug("stripeCustomer retrieved", { stripeCustomer });
      const { email } = stripeCustomer;
      logger.debug("subscription status", { status });
      
      if (status !== "canceled") {
        logger.warn("Subscription is not canceled, skipping", { status });
        return;
      }

      // Generate idempotency key for subscription deletion
      const eventId = generateEventId("subscription-deleted", stripeSubscriptionId);
      
      // Check idempotency
      const idempotencyResult = await ensureIdempotency(
        { dynamoDBClient, tableName: idempotencyTableName, logger },
        eventId,
        { 
          subscriptionId: stripeSubscriptionId, 
          customerId: customer,
          status,
          endedAt: ended_at,
          canceledAt: canceled_at
        }
      );

      if (idempotencyResult.isDuplicate) {
        logger.info("Subscription deletion already processed, skipping", { 
          subscriptionId: stripeSubscriptionId,
          eventId 
        });
        return;
      }

      await eventBridgeClient.send(
        new PutEventsCommand({
          Entries: [
            {
              Source: "service.stripe",
              DetailType: "SubscriptionDeleted",
              EventBusName: eventBusName,
              Detail: JSON.stringify({
                userEmail: email,
                stripeSubscriptionId,
                status,
                endedAt: ended_at,
                canceledAt: canceled_at,
              }),
            },
          ],
        }),
      );

      logger.info("SubscriptionDeleted event sent", {
        subscriptionId: stripeSubscriptionId,
        customerEmail: email,
      });

      // Send email notification for subscription cancellation
      if (email) {
        // Format the access end date
        const accessEndDate = ended_at
          ? new Date(ended_at * 1000).toLocaleDateString('en-US', {
              month: 'long',
              day: 'numeric',
              year: 'numeric',
            })
          : new Date().toLocaleDateString('en-US', {
              month: 'long',
              day: 'numeric',
              year: 'numeric',
            });

        await eventBridgeClient.send(
          new PutEventsCommand({
            Entries: [
              {
                Source: "service.stripe",
                DetailType: "SendSubscriptionCancelledEmail",
                EventBusName: eventBusName,
                Detail: JSON.stringify({
                  stripeSubscriptionId,
                  stripeCustomerId: customer,
                  customerEmail: email,
                  customerName: stripeCustomer.name || undefined,
                  accessEndDate,
                  reactivateUrl: `https://cdkinsights.dev/pricing?reactivate=true&email=${encodeURIComponent(email)}`,
                }),
              },
            ],
          }),
        );

        logger.info("SendSubscriptionCancelledEmail event sent", {
          subscriptionId: stripeSubscriptionId,
          customerEmail: email,
        });
      }
    } catch (error) {
      logger.error("Error processing subscription deletion", {
        subscriptionId: stripeSubscriptionId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  };
