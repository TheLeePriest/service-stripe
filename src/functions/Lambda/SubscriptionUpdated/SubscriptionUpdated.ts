import type {
  SubscriptionUpdatedEvent,
  SubscriptionUpdatedDependencies,
} from "./SubscriptionUpdated.types";
import { handleCancellation } from "./lib/handleCancellation/handleCancellation";
import { handleUncancellation } from "./lib/handleUncancellation/handleUncancellation";
import { handleQuantityChange } from "./lib/handleQuantityChange/handleQuantityChange";
import { determineSubscriptionState } from "./lib/determineSubscriptionState/determineSubscriptionState";
import { handleRenewal } from "./lib/handleRenewal/handleRenewal";
import type { Logger } from "../types/utils.types";
import type Stripe from "stripe";

export const subscriptionUpdated =
  ({
    eventBridgeClient,
    eventBusName,
    eventBusArn,
    eventBusSchedulerRoleArn,
    schedulerClient,
    stripe,
    logger,
    dynamoDBClient,
    idempotencyTableName,
  }: SubscriptionUpdatedDependencies & { logger: Logger }) =>
  async (event: SubscriptionUpdatedEvent) => {
    const { id: stripeSubscriptionId, status } = event;

    logger.info("SubscriptionUpdated handler invoked", {
      subscriptionId: stripeSubscriptionId,
      status,
      eventId: event.id,
      createdAt: event.createdAt,
      customer: event.customer,
    });

    logger.debug("Raw subscription event structure", {
      event: JSON.stringify(event, null, 2),
    });

    logger.logStripeEvent("customer.subscription.updated", event as unknown as Record<string, unknown>);

    try {
      const state = determineSubscriptionState(event);

      logger.info("Determined subscription state", {
        subscriptionId: stripeSubscriptionId,
        status,
        state,
        previousAttributes: event.previousAttributes,
        currentAttributes: {
          status: event.status,
          cancelAtPeriodEnd: event.cancel_at_period_end,
          currentPeriodEnd: event.items?.data?.[0]?.current_period_end,
          currentPeriodStart: event.items?.data?.[0]?.current_period_start,
        },
      });

      switch (state) {
        case "QUANTITY_CHANGED": {
          logger.info("Processing quantity change", {
            subscriptionId: stripeSubscriptionId,
            previousQuantity: event.previousAttributes?.items?.data?.[0]?.quantity,
            currentQuantity: event.items?.data?.[0]?.quantity,
          });

          await handleQuantityChange({
            subscriptionId: event.id,
            previousAttributes: event.previousAttributes,
            subscription: event,
            eventBridgeClient,
            eventBusName,
            stripe,
            logger,
            dynamoDBClient,
            idempotencyTableName,
          });
          break;
        }

        case "CANCELLING":
          logger.info("Processing subscription cancellation", {
            subscriptionId: stripeSubscriptionId,
            cancelAtPeriodEnd: event.cancel_at_period_end,
            currentPeriodEnd: event.items?.data?.[0]?.current_period_end,
          });

          await handleCancellation({
            subscription: event,
            eventBridgeClient,
            eventBusName,
            logger,
            dynamoDBClient,
            idempotencyTableName,
          });
          break;

        case "UNCANCELLING":
          logger.info("Processing subscription uncancellation", {
            subscriptionId: stripeSubscriptionId,
            cancelAtPeriodEnd: event.cancel_at_period_end,
          });

          await handleUncancellation(event, schedulerClient, logger);
          break;

        case "RENEWED":
          logger.info("Processing subscription renewal", {
            subscriptionId: stripeSubscriptionId,
            currentPeriodEnd: event.items?.data?.[0]?.current_period_end,
            currentPeriodStart: event.items?.data?.[0]?.current_period_start,
          });

          await handleRenewal({
            subscription: event,
            eventBridgeClient,
            eventBusName,
            stripe,
            logger,
            dynamoDBClient,
            idempotencyTableName,
          });
          break;

        case "OTHER_UPDATE":
          logger.info("Subscription updated (other change)", {
            subscriptionId: stripeSubscriptionId,
            status,
            changes: {
              statusChanged: event.previousAttributes?.status !== event.status,
              cancelAtPeriodEndChanged: event.previousAttributes?.cancel_at_period_end !== event.cancel_at_period_end,
              currentPeriodEndChanged: event.previousAttributes?.items?.data?.[0]?.current_period_end !== event.items?.data?.[0]?.current_period_end,
            },
          });

          // Check if this is a trial subscription that should be upgraded after payment method was added
          // This handles the case where payment method is added via Customer Portal (which doesn't trigger payment_method.attached)
          // Only check for payment method upgrades if this is a trialing subscription
          if (
            status === 'trialing' &&
            event.trialEnd &&
            event.previousAttributes?.default_payment_method === null
          ) {
            // Retrieve subscription to get current payment method (since it's not in the event structure)
            const subscriptionForCheck = await stripe.subscriptions.retrieve(stripeSubscriptionId);
            const hasPaymentMethodNow = !!subscriptionForCheck.default_payment_method;
            const hadPaymentMethodBefore = event.previousAttributes?.default_payment_method !== null && event.previousAttributes?.default_payment_method !== undefined;
            const paymentMethodWasAdded = !hadPaymentMethodBefore && hasPaymentMethodNow;
            
            logger.info("Checking payment method status for upgrade", {
              subscriptionId: stripeSubscriptionId,
              status,
              previousPaymentMethod: event.previousAttributes?.default_payment_method,
              currentPaymentMethod: subscriptionForCheck.default_payment_method,
              hasPaymentMethodNow,
              hadPaymentMethodBefore,
              paymentMethodWasAdded,
              hasAutoUpgradeFlag: subscriptionForCheck.metadata?.auto_upgrade_on_payment_method === 'true',
            });

            if (paymentMethodWasAdded) {
              logger.info("Checking if trial subscription should be auto-upgraded", {
                subscriptionId: stripeSubscriptionId,
                status,
                paymentMethodWasAdded,
              });

              // Use the subscription we already retrieved
              try {
              if (
                subscriptionForCheck.metadata?.auto_upgrade_on_payment_method === 'true' &&
                subscriptionForCheck.default_payment_method &&
                subscriptionForCheck.status === 'trialing'
              ) {
                logger.info("Auto-upgrading trial subscription after payment method added via portal", {
                  subscriptionId: stripeSubscriptionId,
                  customerId: subscriptionForCheck.customer,
                  targetPriceId: subscriptionForCheck.metadata?.target_price_id,
                });

                // Get subscription items to find base and metered prices
                const subscriptionItems = subscriptionForCheck.items.data;
                const baseItem = subscriptionItems.find(
                  (item) => item.price.recurring?.usage_type !== 'metered',
                );
                const meteredItem = subscriptionItems.find(
                  (item) => item.price.recurring?.usage_type === 'metered',
                );

                // Get target price if specified in metadata, otherwise keep existing base price
                const targetPriceId = subscriptionForCheck.metadata?.target_price_id;
                const itemsUpdate: Stripe.SubscriptionUpdateParams.Item[] = [];

                if (targetPriceId && baseItem) {
                  // Update base price if target price is specified
                  itemsUpdate.push({
                    id: baseItem.id,
                    price: targetPriceId,
                    quantity: 1,
                  });
                  logger.info("Updating base price for upgrade", {
                    subscriptionId: stripeSubscriptionId,
                    oldPriceId: baseItem.price.id,
                    newPriceId: targetPriceId,
                  });
                }

                // Ensure metered price exists (should already be on trial subscriptions)
                if (meteredItem) {
                  logger.info("Metered price already exists on subscription", {
                    subscriptionId: stripeSubscriptionId,
                    meteredPriceId: meteredItem.price.id,
                  });
                } else {
                  logger.warn("No metered price found on trial subscription", {
                    subscriptionId: stripeSubscriptionId,
                  });
                }

                // Update subscription to end trial and upgrade
                // Always explicitly end the trial, even if we're updating items
                // This ensures the trial ends even if the price ID is the same
                const updateParams: Stripe.SubscriptionUpdateParams = {
                  cancel_at_period_end: false,
                  trial_end: 'now', // Always explicitly end the trial
                  metadata: {
                    ...subscriptionForCheck.metadata,
                    auto_upgrade_on_payment_method: 'false', // Clear the flag
                    upgraded_at: new Date().toISOString(),
                    upgrade_type: 'trial_to_paid',
                    is_upgrade: 'true',
                    // Set originalTrialSubscriptionId for SubscriptionUpgraded handler
                    original_trial_subscription_id: stripeSubscriptionId,
                  },
                };

                // Add items update if we have price changes
                if (itemsUpdate.length > 0) {
                  updateParams.items = itemsUpdate;
                  logger.info("Updating subscription with price changes and ending trial", {
                    subscriptionId: stripeSubscriptionId,
                    itemsUpdateCount: itemsUpdate.length,
                  });
                } else {
                  logger.info("Ending trial immediately (no price changes)", {
                    subscriptionId: stripeSubscriptionId,
                  });
                }

                logger.info("Calling Stripe API to upgrade subscription", {
                  subscriptionId: stripeSubscriptionId,
                  updateParams: {
                    ...updateParams,
                    items: itemsUpdate.length > 0 ? `[${itemsUpdate.length} items]` : undefined,
                  },
                });

                const updated = await stripe.subscriptions.update(
                  stripeSubscriptionId,
                  updateParams,
                );

                logger.info("Successfully upgraded trial subscription", {
                  subscriptionId: stripeSubscriptionId,
                  oldStatus: subscriptionForCheck.status,
                  newStatus: updated.status,
                  itemsCount: updated.items.data.length,
                  trialEnd: updated.trial_end,
                  hasPaymentMethod: !!updated.default_payment_method,
                });
              } else {
                logger.debug("Subscription does not meet auto-upgrade criteria", {
                  subscriptionId: stripeSubscriptionId,
                  hasAutoUpgradeFlag: subscriptionForCheck.metadata?.auto_upgrade_on_payment_method === 'true',
                  hasPaymentMethod: !!subscriptionForCheck.default_payment_method,
                  status: subscriptionForCheck.status,
                });
              }
            } catch (upgradeError) {
              logger.error("Failed to check/upgrade trial subscription", {
                subscriptionId: stripeSubscriptionId,
                error: upgradeError instanceof Error ? upgradeError.message : String(upgradeError),
              });
              // Don't throw - continue with normal OTHER_UPDATE processing
              }
            }
          }
          break;

        default: {
          const _exhaustiveCheck: never = state;
          logger.warn("Unhandled subscription state", {
            subscriptionId: stripeSubscriptionId,
            state,
            status,
          });
          return _exhaustiveCheck;
        }
      }

      logger.info("Successfully processed subscription update", {
        subscriptionId: stripeSubscriptionId,
        state,
        status,
      });

    } catch (error) {
      logger.error("Error processing subscription", {
        subscriptionId: stripeSubscriptionId,
        status,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      throw error;
    }
  };
