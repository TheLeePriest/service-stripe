import type {
  SubscriptionCreatedEvent,
  SubscriptionCreatedDependencies,
  SubscriptionCreatedResult,
} from "./SubscriptionCreated.types";
import { PutEventsCommand } from "@aws-sdk/client-eventbridge";
import { ensureIdempotency, generateEventId } from "../lib/idempotency";

export const subscriptionCreated =
  (dependencies: SubscriptionCreatedDependencies) =>
  async (subscription: SubscriptionCreatedEvent): Promise<SubscriptionCreatedResult> => {
    const { stripe, eventBridgeClient, eventBusName, dynamoDBClient, idempotencyTableName, logger } = dependencies;
    
    logger.logStripeEvent("customer.subscription.created", subscription as unknown as Record<string, unknown>);
    logger.info("Processing subscription created", { 
      subscriptionId: subscription.id,
      customerId: subscription.customer,
    });

    try {
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
        return {
          success: true,
          subscriptionId: subscription.id,
          customerId: subscription.customer,
          isTeamSubscription: false,
          alreadyProcessed: true,
        };
      }

      // Process subscription items for team detection
      const items = await Promise.all(
        subscription.items.data.map(async (item) => {
          // Get product details
          const product = await stripe.products.retrieve(item.price.product);
          const priceData = await stripe.prices.retrieve(item.price.id);

          // Team detection logic
          const isTeamSubscription = product.metadata?.tier === 'enterprise' || 
                                   item.quantity > 1 ||
                                   product.metadata?.product_type === 'enterprise_team';

          return {
            itemId: item.id,
            productId: product.id,
            productName: product.name,
            productMetadata: product.metadata || {},
            priceId: item.price.id,
            priceData: {
              unitAmount: priceData.unit_amount,
              currency: priceData.currency,
              recurring: priceData.recurring,
              metadata: priceData.metadata || {},
            },
            quantity: item.quantity,
            expiresAt: item.current_period_end,
            metadata: item.metadata || {},
            isTeamSubscription,
            teamSize: isTeamSubscription ? item.quantity : undefined,
          };
        })
      );

      // Determine if this is a team subscription
      const teamItems = items.filter(item => item.isTeamSubscription);
      const isTeamSubscription = teamItems.length > 0;

      logger.info("Processed subscription items", {
        subscriptionId: subscription.id,
        totalItems: items.length,
        teamItems: teamItems.length,
        individualItems: items.filter(item => !item.isTeamSubscription).length,
        isTeamSubscription,
      });

      // Prepare team context if this is a team subscription
      let teamContext: {
        isTeamSubscription: boolean;
        teamSize: number;
        productName: string;
        productTier: string;
      } | undefined;

      if (isTeamSubscription) {
        const baseTeamItem = teamItems[0];
        teamContext = {
          isTeamSubscription: true,
          teamSize: Math.max(...teamItems.map(item => item.teamSize || 0)),
          productName: baseTeamItem.productName,
          productTier: baseTeamItem.productMetadata?.tier || 'enterprise',
        };

        logger.info("Team subscription context prepared", {
          subscriptionId: subscription.id,
          teamContext,
        });
      }

      // Emit SubscriptionCreated event for downstream services
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
                customerEmail: subscription.customerEmail,
                customerName: subscription.customerName,
                items,
                status: subscription.status,
                createdAt: subscription.created,
                cancelAtPeriodEnd: subscription.cancel_at_period_end,
                // Team context if applicable
                ...(teamContext && { teamContext }),
                // Metadata for tracking
                metadata: {
                  ...subscription.metadata,
                  processed_by: 'service-stripe',
                  processed_at: new Date().toISOString(),
                },
              }),
            },
          ],
        }),
      );

      logger.info("SubscriptionCreated event emitted successfully", {
        subscriptionId: subscription.id,
        customerId: subscription.customer,
        eventType: "SubscriptionCreated",
      });

      return {
        success: true,
        subscriptionId: subscription.id,
        customerId: subscription.customer,
        isTeamSubscription: !!teamContext,
        teamSize: teamContext?.teamSize,
      };

    } catch (error) {
      logger.error("Error processing subscription created", {
        subscriptionId: subscription.id,
        customerId: subscription.customer,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  };
