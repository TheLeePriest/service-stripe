import type { EventBridgeEvent } from "aws-lambda";
import type {
  SetupIntentSucceededDependencies,
  SetupIntentSucceededEvent,
} from "./SetupIntentSucceeded.types";
import { sendEvent } from "../lib/sendEvent";
import { ensureIdempotency, generateEventId } from "../lib/idempotency";
import type Stripe from "stripe";

export const setupIntentSucceeded =
  ({
    stripe,
    eventBridgeClient,
    eventBusName,
    dynamoDBClient,
    idempotencyTableName,
    logger,
  }: SetupIntentSucceededDependencies) =>
  async (event: EventBridgeEvent<string, unknown>) => {
    logger.info("SetupIntentSucceeded handler invoked", {
      eventId: event.id,
      source: event.source,
      detailType: event["detail-type"],
      time: event.time,
      region: event.region,
      account: event.account,
    });

    logger.debug("Raw event structure", {
      eventId: event.id,
      detailType: event["detail-type"],
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

      const stripeData = stripeEvent.data as Record<string, unknown>;
      if (!stripeData?.object) {
        logger.error("Missing stripe event data.object", {
          stripeEvent: stripeEvent,
        });
        throw new Error("Invalid Stripe event structure: missing data.object");
      }

      const setupIntent = stripeData.object as Record<string, unknown>;

      logger.info("Extracted setup intent data", {
        setupIntentId: setupIntent.id,
        customerId: setupIntent.customer,
        paymentMethodId: setupIntent.payment_method,
        status: setupIntent.status,
        created: setupIntent.created,
        metadata: setupIntent.metadata,
      });

      if (!setupIntent.id || !setupIntent.customer || !setupIntent.payment_method) {
        logger.error("Missing required setup intent fields", {
          setupIntentId: setupIntent.id,
          customerId: setupIntent.customer,
          paymentMethodId: setupIntent.payment_method,
        });
        throw new Error("Setup intent missing required fields: id, customer, or payment_method");
      }

      const setupIntentId = setupIntent.id as string;
      const customer = setupIntent.customer as string;
      const paymentMethodId = setupIntent.payment_method as string;
      const metadata = (setupIntent.metadata || {}) as Record<string, string>;
      const created = setupIntent.created as number;

      // Check if this is for a subscription upgrade
      const subscriptionId = metadata.subscription_id;
      const requiresUpgrade = metadata.requires_upgrade === "true";

      if (!subscriptionId || !requiresUpgrade) {
        logger.info("Setup intent not for subscription upgrade, skipping", {
          setupIntentId,
          hasSubscriptionId: !!subscriptionId,
          requiresUpgrade,
        });
        return;
      }

      logger.info("Processing setup intent for subscription upgrade", {
        setupIntentId,
        subscriptionId,
        customerId: customer,
        paymentMethodId,
      });

      // Generate idempotency key
      const eventId = generateEventId("setup-intent-succeeded", setupIntentId, created);

      // Check idempotency
      const idempotencyResult = await ensureIdempotency(
        { dynamoDBClient, tableName: idempotencyTableName, logger },
        eventId,
        {
          setupIntentId,
          subscriptionId,
          customerId: customer,
          paymentMethodId,
        },
      );

      if (idempotencyResult.isDuplicate) {
        logger.info("Setup intent already processed, skipping", {
          setupIntentId,
          eventId,
        });
        return;
      }

      // Retrieve the subscription to verify it exists and is a trial
      const subscription = await stripe.subscriptions.retrieve(subscriptionId);

      // Verify the customer matches
      const subscriptionCustomerId =
        typeof subscription.customer === "string"
          ? subscription.customer
          : subscription.customer.id;
      if (subscriptionCustomerId !== customer) {
        logger.error("Customer ID mismatch", {
          setupIntentCustomerId: customer,
          subscriptionCustomerId,
          subscriptionId,
        });
        throw new Error("Customer ID does not match subscription");
      }

      // Verify it's a trial subscription
      if (!subscription.trial_end || subscription.status !== "trialing") {
        logger.warn("Subscription is not a trial, skipping upgrade", {
          subscriptionId,
          status: subscription.status,
          trialEnd: subscription.trial_end,
        });
        return;
      }

      logger.info("Upgrading trial subscription", {
        subscriptionId,
        customerId: customer,
        paymentMethodId,
        currentStatus: subscription.status,
      });

      // 1. Attach the payment method to the customer
      await stripe.paymentMethods.attach(paymentMethodId, {
        customer: customer,
      });

      logger.info("Payment method attached to customer", {
        paymentMethodId,
        customerId: customer,
      });

      // 2. Set it as the default payment method for the customer
      await stripe.customers.update(customer, {
        invoice_settings: {
          default_payment_method: paymentMethodId,
        },
      });

      logger.info("Payment method set as default for customer", {
        paymentMethodId,
        customerId: customer,
      });

      // 3. Update the subscription to end the trial and use this payment method
      const updateParams: Stripe.SubscriptionUpdateParams = {
        default_payment_method: paymentMethodId,
        trial_end: "now", // End trial immediately and start billing
        metadata: {
          ...subscription.metadata,
          upgraded_at: new Date().toISOString(),
          upgrade_type: "trial_to_paid",
          is_upgrade: "true",
          original_trial_subscription_id: subscriptionId,
          upgrade_reason: metadata.upgrade_reason || "trial_upgrade",
          ...(metadata.target_price_id && { target_price_id: metadata.target_price_id }),
        },
      };

      // If target_price_id is specified, update the base price
      if (metadata.target_price_id) {
        const baseItem = subscription.items.data.find(
          (item) => item.price.recurring?.usage_type !== "metered",
        );
        if (baseItem && baseItem.price.id !== metadata.target_price_id) {
          updateParams.items = [
            {
              id: baseItem.id,
              price: metadata.target_price_id,
              quantity: 1,
            },
          ];
          logger.info("Updating base price during upgrade", {
            subscriptionId,
            oldPriceId: baseItem.price.id,
            newPriceId: metadata.target_price_id,
          });
        }
      }

      const updated = await stripe.subscriptions.update(subscriptionId, updateParams);

      logger.info("Successfully upgraded trial subscription", {
        subscriptionId,
        oldStatus: subscription.status,
        newStatus: updated.status,
        trialEnd: updated.trial_end,
        hasPaymentMethod: !!updated.default_payment_method,
      });

      // 4. Send event to EventBridge for downstream services
      await sendEvent(
        eventBridgeClient,
        [
          {
            Source: "service.stripe",
            DetailType: "SetupIntentSucceeded",
            Detail: JSON.stringify({
              stripeSetupIntentId: setupIntentId,
              stripePaymentMethodId: paymentMethodId,
              stripeCustomerId: customer,
              stripeSubscriptionId: subscriptionId,
              upgradeType: "trial_to_paid",
              upgradedAt: new Date().toISOString(),
              metadata: {
                ...metadata,
                processed_by: "service-stripe",
                processed_at: new Date().toISOString(),
              },
            }),
            EventBusName: eventBusName,
          },
        ],
        logger,
      );

      logger.info("SetupIntentSucceeded event sent", {
        setupIntentId,
        subscriptionId,
      });
    } catch (error) {
      logger.error("Error processing setup intent", {
        eventId: event.id,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      throw error;
    }
  };
