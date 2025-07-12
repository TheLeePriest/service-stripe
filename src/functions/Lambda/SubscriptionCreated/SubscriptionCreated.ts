import type Stripe from "stripe";
import type {
  SubscriptionCreatedEvent,
  SubscriptionCreatedDependencies,
} from "./SubscriptionCreated.types";
import { PutEventsCommand } from "@aws-sdk/client-eventbridge";
import type { Logger } from "../types/utils.types";
import { ensureIdempotency, generateEventId } from "../lib/idempotency";

export const subscriptionCreated =
  (dependencies: SubscriptionCreatedDependencies & { logger: Logger }) =>
  async (subscription: SubscriptionCreatedEvent) => {
    const { stripe, eventBridgeClient, dynamoDBClient, eventBusName, idempotencyTableName, logger } = dependencies;

    logger.logStripeEvent("customer.subscription.created", subscription as unknown as Record<string, unknown>);

    // Generate idempotency key
    const eventId = generateEventId("subscription-created", subscription.id, subscription.created);
    
    // Check idempotency
    const idempotencyResult = await ensureIdempotency(
      { dynamoDBClient, tableName: idempotencyTableName, logger },
      eventId,
      { subscriptionId: subscription.id, customerId: subscription.customer }
    );

    if (idempotencyResult.isDuplicate) {
      logger.info("Subscription already processed, skipping", { 
        subscriptionId: subscription.id,
        eventId 
      });
      return;
    }

    try {
      const customer = (await stripe.customers.retrieve(
        subscription.customer as string,
      )) as Stripe.Customer;

      // Batch retrieve products and prices to reduce API calls
      const productIds = [...new Set(subscription.items.data.map(item => item.price.product as string))];
      const priceIds = subscription.items.data.map(item => item.price.id);

      // Batch retrieve products
      const products = await Promise.all(
        productIds.map(id => stripe.products.retrieve(id))
      );
      const productMap = new Map(products.map(product => [product.id, product]));

      // Batch retrieve prices
      const prices = await Promise.all(
        priceIds.map(id => stripe.prices.retrieve(id))
      );
      const priceMap = new Map(prices.map(price => [price.id, price]));

      const items = subscription.items.data.map((item) => {
        const product = productMap.get(item.price.product as string);
        const priceData = priceMap.get(item.price.id);
        
        if (!product || !priceData) {
          throw new Error(`Missing product or price data for item ${item.id}`);
        }

        logger.debug("Processing subscription item", { item });
        logger.debug("Retrieved price data", { priceData });
        logger.debug("Retrieved product", { product, itemId: item.id });
        
        return {
          itemId: item.id,
          productId: product.id,
          productName: product.name,
          priceId: item.price.id,
          priceData: {
            unitAmount: priceData.unit_amount,
            currency: priceData.currency,
            recurring: priceData.recurring,
            metadata: priceData.metadata,
          },
          quantity: item.quantity,
          expiresAt: item.current_period_end,
          metadata: item.metadata,
        };
      });

      logger.info("Processing subscription for customer", { 
        subscriptionId: subscription.id, 
        customerId: customer.id 
      });
      logger.debug("Items processed for subscription", { items, subscriptionId: subscription.id });

      await eventBridgeClient.send(
        new PutEventsCommand({
          Entries: [
            {
              Source: "service.stripe",
              DetailType: "SubscriptionCreated",
              EventBusName: eventBusName,
              Detail: JSON.stringify({
                stripeSubscriptionId: subscription.id,
                stripeCustomerId: subscription.customer,
                customerEmail: customer.email,
                items,
                status: subscription.status,
                createdAt: subscription.created,
                cancelAtPeriodEnd: subscription.cancel_at_period_end,
                ...(subscription.trial_start && {
                  trialStart: subscription.trial_start,
                }),
                ...(subscription.trial_end && {
                  trialEnd: subscription.trial_end,
                }),
              }),
            },
          ],
        }),
      );

      logger.info("SubscriptionCreated event sent for subscription", { 
        subscriptionId: subscription.id 
      });
    } catch (error) {
      logger.error("Error processing subscription", { 
        subscriptionId: subscription.id,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  };
