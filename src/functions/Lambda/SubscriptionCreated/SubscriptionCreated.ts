import type {
  SubscriptionCreatedEvent,
  SubscriptionCreatedDependencies,
  ProcessedSubscriptionItem,
} from "./SubscriptionCreated.types";
import { PutEventsCommand } from "@aws-sdk/client-eventbridge";
import { ensureIdempotency, generateEventId } from "../lib/idempotency";
import type Stripe from "stripe";

export const subscriptionCreated =
  (dependencies: SubscriptionCreatedDependencies) =>
  async (subscription: SubscriptionCreatedEvent) => {
    const {
      stripe,
      eventBridgeClient,
      dynamoDBClient,
      eventBusName,
      idempotencyTableName,
      logger,
    } = dependencies;
    console.log("subscription", subscription);
    logger.logStripeEvent(
      "customer.subscription.created",
      subscription as unknown as Record<string, unknown>,
    );
    logger.info("Processing subscription created", { subscription });
    // Generate idempotency key
    const eventId = generateEventId(
      "subscription-created",
      subscription.id,
      subscription.created,
    );

    // Check idempotency
    const idempotencyResult = await ensureIdempotency(
      { dynamoDBClient, tableName: idempotencyTableName, logger },
      eventId,
      { subscriptionId: subscription.id, customerId: subscription.customer },
    );

    if (idempotencyResult.isDuplicate) {
      logger.info("Subscription already processed, skipping", {
        subscriptionId: subscription.id,
        eventId,
      });
      return {
        success: true,
        subscriptionId: subscription.id,
        customerId: subscription.customer,
        isTeamSubscription: false,
        alreadyProcessed: true,
      };
    }

    const userDetails = (await stripe.customers.retrieve(
      subscription.customer,
    )) as Stripe.Customer;

    console.log(userDetails, "userDetails");

    try {
      // Batch retrieve products and prices to reduce API calls
      const productIds = [
        ...new Set(
          subscription.items.data.map((item) => item.price.product as string),
        ),
      ];
      const priceIds = subscription.items.data.map((item) => item.price.id);

      // Batch retrieve products
      const products = await Promise.all(
        productIds.map((id) => stripe.products.retrieve(id)),
      );
      const productMap = new Map(
        products.map((product) => [product.id, product]),
      );

      // Batch retrieve prices
      const prices = await Promise.all(
        priceIds.map((id) => stripe.prices.retrieve(id)),
      );
      const priceMap = new Map(prices.map((price) => [price.id, price]));

      const items: ProcessedSubscriptionItem[] = subscription.items.data.map(
        (item) => {
          const product = productMap.get(item.price.product as string);
          const priceData = priceMap.get(item.price.id);

          if (!product || !priceData) {
            throw new Error(
              `Missing product or price data for item ${item.id}`,
            );
          }

          // Detect if this is a team subscription based on product tier
          const isTeamSubscription = product.metadata?.tier === "enterprise";
          const teamSize = isTeamSubscription ? item.quantity : undefined;

          logger.debug("Processing subscription item", {
            item,
            productTier: product.metadata?.tier,
            isTeamSubscription,
            teamSize,
          });
          logger.debug("Retrieved price data", { priceData });
          logger.debug("Retrieved product", { product, itemId: item.id });

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
            teamSize,
          };
        },
      );

      logger.info("Processing subscription for customer", {
        subscriptionId: subscription.id,
        customerId: subscription.customer,
        totalItems: items.length,
        teamItems: items.filter((item) => item.isTeamSubscription).length,
        individualItems: items.filter((item) => !item.isTeamSubscription)
          .length,
      });
      logger.debug("Items processed for subscription", {
        items,
        subscriptionId: subscription.id,
      });

      // Log team detection summary
      const teamItems = items.filter((item) => item.isTeamSubscription);
      if (teamItems.length > 0) {
        logger.info("Team subscription detected", {
          subscriptionId: subscription.id,
          teamItems: teamItems.map((item) => ({
            productName: item.productName,
            productTier: item.productMetadata?.tier,
            teamSize: item.teamSize,
            quantity: item.quantity,
          })),
        });
      } else {
        logger.info("Individual subscription detected", {
          subscriptionId: subscription.id,
          items: items.map((item) => ({
            productName: item.productName,
            productTier: item.productMetadata?.tier,
            quantity: item.quantity,
          })),
        });
      }

      // ============================================================================
      // TEAM DETECTION (TEAM SUBSCRIPTIONS ONLY)
      // ============================================================================

      let teamContext:
        | {
            isTeamSubscription: boolean;
            teamSize: number;
            productName: string;
            productTier: string;
          }
        | undefined;

      if (teamItems.length > 0) {
        logger.info("Team subscription detected - emitting team context", {
          subscriptionId: subscription.id,
          teamItemsCount: teamItems.length,
        });

        // Set team context for the event (no team creation here)
        const baseTeamItem = teamItems[0];
        teamContext = {
          isTeamSubscription: true,
          teamSize: Math.max(...teamItems.map((item) => item.teamSize || 0)),
          productName: baseTeamItem.productName,
          productTier: baseTeamItem.productMetadata?.tier || "enterprise",
        };

        logger.info("Team context prepared for event", {
          subscriptionId: subscription.id,
          teamContext,
        });
      }
      console.log(subscription, "subscription before event");
      // Send SubscriptionCreated event
      await eventBridgeClient.send(
        new PutEventsCommand({
          Entries: [
            {
              Source: "service.stripe",
              DetailType: "SubscriptionCreated",
              EventBusName: eventBusName,
              Detail: JSON.stringify({
                customerEmail: userDetails.email,
                customerName: userDetails.name,
                stripeSubscriptionId: subscription.id,
                stripeCustomerId: subscription.customer,
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
                ...(teamContext && {
                  teamContext,
                }),
              }),
            },
          ],
        }),
      );

      logger.info("SubscriptionCreated event sent for subscription", {
        subscriptionId: subscription.id,
        subscription: subscription,
      });

      logger.info("Subscription creation processed successfully", {
        subscriptionId: subscription.id,
        customerId: subscription.customer,
        eventCount: 1, // Only SubscriptionCreated event
      });

      return {
        success: true,
        subscriptionId: subscription.id,
        customerId: subscription.customer,
        isTeamSubscription: !!teamContext,
        teamSize: teamContext?.teamSize,
      };
    } catch (error) {
      logger.error("Error processing subscription", {
        subscriptionId: subscription.id,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  };
