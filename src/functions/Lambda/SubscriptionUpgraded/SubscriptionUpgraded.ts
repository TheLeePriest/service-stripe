import type {
  SubscriptionUpgradedEvent,
  SubscriptionUpgradedDependencies,
  SubscriptionUpgradedResult,
} from "./SubscriptionUpgraded.types";
import { sendEvent } from "../lib/sendEvent";

export const subscriptionUpgraded =
  (dependencies: SubscriptionUpgradedDependencies) =>
  async (subscription: SubscriptionUpgradedEvent): Promise<SubscriptionUpgradedResult> => {
    const { stripe, eventBridgeClient, eventBusName, logger } = dependencies;
    
    logger.info("Processing subscription upgrade", { 
      subscriptionId: subscription.id,
      customerId: subscription.customer,
      upgradeType: subscription.metadata?.upgrade_type,
      originalTrialSubscriptionId: subscription.metadata?.original_trial_subscription_id,
    });

    try {
      // Extract upgrade information from metadata
      const upgradeType = subscription.metadata?.upgrade_type;
      const originalTrialSubscriptionId = subscription.metadata?.original_trial_subscription_id;
      const upgradeReason = subscription.metadata?.upgrade_reason;
      const productTier = subscription.metadata?.product_tier;
      const pricingModel = subscription.metadata?.pricing_model;

      // Validate upgrade metadata
      if (!upgradeType || !originalTrialSubscriptionId) {
        logger.warn("Missing upgrade metadata, treating as regular subscription", {
          subscriptionId: subscription.id,
          metadata: subscription.metadata,
        });
        return {
          success: false,
          subscriptionId: subscription.id,
          customerId: subscription.customer,
          upgradeType: "unknown",
        };
      }

      // Get customer details from Stripe for email notification
      const customer = await stripe.customers.retrieve(subscription.customer);
      const customerEmail = !('deleted' in customer) ? customer.email || "" : "";
      const customerName = !('deleted' in customer) ? customer.name || "" : "";

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

      // Determine if this is a team upgrade
      const teamItems = items.filter(item => item.isTeamSubscription);
      const isTeamUpgrade = teamItems.length > 0;

      logger.info("Processed upgrade subscription items", {
        subscriptionId: subscription.id,
        totalItems: items.length,
        teamItems: teamItems.length,
        individualItems: items.filter(item => !item.isTeamSubscription).length,
        isTeamUpgrade,
      });

      // Prepare team context if this is a team upgrade
      let teamContext: {
        isTeamSubscription: boolean;
        teamSize: number;
        productName: string;
        productTier: string;
      } | undefined;

      if (isTeamUpgrade) {
        const baseTeamItem = teamItems[0];
        teamContext = {
          isTeamSubscription: true,
          teamSize: Math.max(...teamItems.map(item => item.teamSize || 0)),
          productName: baseTeamItem.productName,
          productTier: baseTeamItem.productMetadata?.tier || 'enterprise',
        };

        logger.info("Team upgrade context prepared", {
          subscriptionId: subscription.id,
          teamContext,
        });
      }

      // Emit SubscriptionUpgraded event for downstream services
      await sendEvent(
        eventBridgeClient,
        [
          {
            Source: "service.stripe",
            DetailType: "SubscriptionUpgraded",
            EventBusName: eventBusName,
            Detail: JSON.stringify({
              stripeSubscriptionId: subscription.id,
              stripeCustomerId: subscription.customer,
              customerEmail,
              customerName,
              items,
              status: subscription.status,
              createdAt: subscription.created,
              cancelAtPeriodEnd: subscription.cancel_at_period_end,
              upgradeType,
              originalTrialSubscriptionId,
              upgradeReason,
              productTier,
              pricingModel,
              ...(teamContext && { teamContext }),
              metadata: {
                ...subscription.metadata,
                processed_by: 'service-stripe',
                processed_at: new Date().toISOString(),
              },
            }),
          },
        ],
        logger,
      );

      logger.info("SubscriptionUpgraded event emitted successfully", {
        subscriptionId: subscription.id,
        customerId: subscription.customer,
        upgradeType,
        originalTrialSubscriptionId,
        eventType: "SubscriptionUpgraded",
      });

      return {
        success: true,
        subscriptionId: subscription.id,
        customerId: subscription.customer,
        upgradeType,
        originalTrialSubscriptionId,
        upgradeReason,
      };

    } catch (error) {
      logger.error("Error processing subscription upgrade", {
        subscriptionId: subscription.id,
        customerId: subscription.customer,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  };
