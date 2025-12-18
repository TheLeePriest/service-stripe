import type { EventBridgeEvent } from "aws-lambda";
import type { PaymentMethodAttachedEvent, PaymentMethodAttachedDependencies } from "./PaymentMethodAttached.types";
import { PutEventsCommand } from "@aws-sdk/client-eventbridge";
import type { Logger } from "../types/utils.types";
import { ensureIdempotency, generateEventId } from "../lib/idempotency";
import type Stripe from "stripe";

export const paymentMethodAttached =
  ({
    stripe,
    eventBridgeClient,
    eventBusName,
    dynamoDBClient,
    idempotencyTableName,
    logger,
  }: PaymentMethodAttachedDependencies & { logger: Logger }) =>
  async (event: EventBridgeEvent<string, unknown>) => {
    logger.info("PaymentMethodAttached handler invoked", {
      eventId: event.id,
      source: event.source,
      detailType: event["detail-type"],
      time: event.time,
      region: event.region,
      account: event.account,
    });

    logger.debug("Raw event structure", {
      event: JSON.stringify(event, null, 2),
    });

    try {
      // Extract the Stripe event from the EventBridge event
      const stripeEvent = event.detail as Record<string, unknown>;
      
      logger.info("Extracted Stripe event", {
        stripeEventType: stripeEvent.type,
        stripeEventId: stripeEvent.id,
        hasData: !!stripeEvent.data,
        hasObject: !!(stripeEvent.data as Record<string, unknown>)?.object,
      });

      logger.debug("Stripe event detail", {
        stripeEvent: JSON.stringify(stripeEvent, null, 2),
      });

      const stripeData = stripeEvent.data as Record<string, unknown>;
      if (!stripeData?.object) {
        logger.error("Missing stripe event data.object", {
          stripeEvent: stripeEvent,
        });
        throw new Error("Invalid Stripe event structure: missing data.object");
      }

      const paymentMethod = stripeData.object as Record<string, unknown>;
      
      logger.info("Extracted payment method data", {
        paymentMethodId: paymentMethod.id,
        customerId: paymentMethod.customer,
        type: paymentMethod.type,
        card: paymentMethod.card,
        created: paymentMethod.created,
      });

      logger.debug("Full payment method object", {
        paymentMethod: JSON.stringify(paymentMethod, null, 2),
      });

      if (!paymentMethod.id || !paymentMethod.customer || !paymentMethod.type) {
        logger.error("Missing required payment method fields", {
          paymentMethodId: paymentMethod.id,
          customerId: paymentMethod.customer,
          type: paymentMethod.type,
        });
        throw new Error("Payment method missing required fields: id, customer, or type");
      }

      const paymentMethodId = paymentMethod.id as string;
      const customer = paymentMethod.customer as string;
      const type = paymentMethod.type as string;
      const card = paymentMethod.card as Record<string, unknown> | undefined;
      const created = paymentMethod.created as number;

      logger.logStripeEvent("payment_method.attached", stripeEvent as Record<string, unknown>);

      // Generate idempotency key
      const eventId = generateEventId("payment-method-attached", paymentMethodId, created);
      
      // Check idempotency
      const idempotencyResult = await ensureIdempotency(
        { dynamoDBClient, tableName: idempotencyTableName, logger },
        eventId,
        { 
          paymentMethodId, 
          customerId: customer,
          type,
          created
        }
      );

      if (idempotencyResult.isDuplicate) {
        logger.info("Payment method attachment already processed, skipping", { 
          paymentMethodId,
          eventId 
        });
        return;
      }

      // Retrieve customer details
      const customerData = await stripe.customers.retrieve(customer) as Stripe.Customer;

      logger.info("Processing payment method attachment", {
        paymentMethodId,
        customerId: customer,
        type,
      });

      // Check for trialing subscriptions that should be auto-upgraded
      const trialingSubscriptions = await stripe.subscriptions.list({
        customer: customer,
        status: 'trialing',
        limit: 100,
      });

      logger.info("Found trialing subscriptions", {
        customerId: customer,
        count: trialingSubscriptions.data.length,
        subscriptionIds: trialingSubscriptions.data.map((s) => ({
          id: s.id,
          hasAutoUpgradeFlag: s.metadata?.auto_upgrade_on_payment_method === 'true',
          metadata: s.metadata,
        })),
      });

      // Upgrade any subscriptions marked for auto-upgrade
      for (const subscription of trialingSubscriptions.data) {
        logger.debug("Checking subscription for auto-upgrade", {
          subscriptionId: subscription.id,
          hasAutoUpgradeFlag: subscription.metadata?.auto_upgrade_on_payment_method === 'true',
          metadata: subscription.metadata,
        });

        if (subscription.metadata?.auto_upgrade_on_payment_method === 'true') {
          logger.info("Upgrading trial subscription on payment method attachment", {
            subscriptionId: subscription.id,
            customerId: customer,
            targetPriceId: subscription.metadata?.target_price_id,
          });

          try {
            // Get subscription items to find base and metered prices
            const subscriptionItems = subscription.items.data;
            const baseItem = subscriptionItems.find(
              (item) => item.price.recurring?.usage_type !== 'metered',
            );
            const meteredItem = subscriptionItems.find(
              (item) => item.price.recurring?.usage_type === 'metered',
            );

            // Get target price if specified in metadata, otherwise keep existing base price
            const targetPriceId = subscription.metadata?.target_price_id;
            const itemsUpdate: Stripe.SubscriptionUpdateParams.Item[] = [];

            if (targetPriceId && baseItem) {
              // Update base price if target price is specified
              itemsUpdate.push({
                id: baseItem.id,
                price: targetPriceId,
                quantity: 1,
              });
              logger.info("Updating base price for upgrade", {
                subscriptionId: subscription.id,
                oldPriceId: baseItem.price.id,
                newPriceId: targetPriceId,
              });
            }

            // Ensure metered price exists (should already be on trial subscriptions)
            if (meteredItem) {
              logger.info("Metered price already exists on subscription", {
                subscriptionId: subscription.id,
                meteredPriceId: meteredItem.price.id,
              });
            } else {
              logger.warn("No metered price found on trial subscription", {
                subscriptionId: subscription.id,
              });
            }

            // Update subscription to end trial and upgrade
            // If we have items to update, include them. Otherwise, just update metadata and end trial
            const updateParams: Stripe.SubscriptionUpdateParams = {
              cancel_at_period_end: false,
              metadata: {
                ...subscription.metadata,
                auto_upgrade_on_payment_method: 'false', // Clear the flag
                upgraded_at: new Date().toISOString(),
                upgrade_type: 'trial_to_paid',
                is_upgrade: 'true',
              },
            };

            // Add items update if we have price changes
            if (itemsUpdate.length > 0) {
              updateParams.items = itemsUpdate;
              // Stripe automatically ends trial when we update subscription items
              logger.info("Updating subscription with price changes", {
                subscriptionId: subscription.id,
                itemsUpdateCount: itemsUpdate.length,
              });
            } else {
              // If no price changes, explicitly end the trial
              updateParams.trial_end = 'now';
              logger.info("Ending trial immediately (no price changes)", {
                subscriptionId: subscription.id,
              });
            }

            logger.info("Calling Stripe API to upgrade subscription", {
              subscriptionId: subscription.id,
              updateParams: {
                ...updateParams,
                items: itemsUpdate.length > 0 ? `[${itemsUpdate.length} items]` : undefined,
              },
            });

            const updated = await stripe.subscriptions.update(
              subscription.id,
              updateParams,
            );

            logger.info("Successfully upgraded trial subscription", {
              subscriptionId: subscription.id,
              oldStatus: subscription.status,
              newStatus: updated.status,
              itemsCount: updated.items.data.length,
              trialEnd: updated.trial_end,
              hasPaymentMethod: !!updated.default_payment_method,
            });
          } catch (upgradeError) {
            logger.error("Failed to upgrade trial subscription", {
              subscriptionId: subscription.id,
              customerId: customer,
              error: upgradeError instanceof Error ? upgradeError.message : String(upgradeError),
            });
            // Continue processing other subscriptions even if one fails
          }
        }
      }

      // Send event to EventBridge
      await eventBridgeClient.send(
        new PutEventsCommand({
          Entries: [
            {
              Source: "service.stripe",
              DetailType: "PaymentMethodAttached",
              Detail: JSON.stringify({
                stripePaymentMethodId: paymentMethodId,
                stripeCustomerId: customer,
                customerEmail: customerData.email,
                type,
                card,
                createdAt: created,
                customerData: {
                  id: customerData.id,
                  email: customerData.email,
                  name: customerData.name,
                },
              }),
              EventBusName: eventBusName,
            },
          ],
        }),
      );

      logger.info("PaymentMethodAttached event sent", { 
        paymentMethodId 
      });
    } catch (error) {
      logger.error("Error processing payment method attachment", {
        eventId: event.id,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      throw error;
    }
  }; 