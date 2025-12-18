import type Stripe from "stripe";
import type { SessionCompletedDependencies } from "./SessionCompleted.types";
import { PutEventsCommand } from "@aws-sdk/client-eventbridge";
import { ensureIdempotency, generateEventId } from "../lib/idempotency";

export const sessionCompleted =
  ({ stripe, eventBridgeClient, eventBusName, logger, dynamoDBClient, idempotencyTableName }: SessionCompletedDependencies) =>
  async (event: Stripe.CheckoutSessionCompletedEvent.Data) => {
    const { object } = event;

    console.log(JSON.stringify(event), 'eventeventevent');

    if (!object) {
      logger.warn("Missing session data, skipping", { event });
      return;
    }

    const sessionId = object.id;
    const session = await stripe.checkout.sessions.retrieve(sessionId, {
      expand: [
        "customer",
        "subscription",
        "subscription.items.data.price",
        "payment_intent",
        "setup_intent",
        "custom_fields",
        "customer_details",
      ],
    });

    // Handle setup mode sessions (for trial upgrades)
    if (session.mode === 'setup') {
      logger.info("Processing setup mode checkout session", {
        sessionId,
        customerId: session.customer,
      });

      const setupIntent = session.setup_intent as Stripe.SetupIntent | null;
      if (!setupIntent) {
        logger.warn("Setup mode session missing setup_intent, skipping", { sessionId });
        return;
      }

      const customer = session.customer as string;
      if (!customer) {
        logger.warn("Setup mode session missing customer, skipping", { sessionId });
        return;
      }

      // Check if this is for a subscription upgrade
      const metadata = setupIntent.metadata || {};
      const subscriptionId = metadata.subscription_id;
      const requiresUpgrade = metadata.requires_upgrade === 'true';

      if (!subscriptionId || !requiresUpgrade) {
        logger.info("Setup intent not for subscription upgrade, skipping", {
          sessionId,
          setupIntentId: setupIntent.id,
          hasSubscriptionId: !!subscriptionId,
          requiresUpgrade,
        });
        return;
      }

      logger.info("Processing setup intent for subscription upgrade via checkout session", {
        sessionId,
        setupIntentId: setupIntent.id,
        subscriptionId,
        customerId: customer,
        paymentMethodId: setupIntent.payment_method,
      });

      // Retrieve the subscription to verify it exists and is a trial
      const subscription = await stripe.subscriptions.retrieve(subscriptionId);

      // Verify the customer matches
      const subscriptionCustomerId =
        typeof subscription.customer === "string"
          ? subscription.customer
          : subscription.customer.id;
      if (subscriptionCustomerId !== customer) {
        logger.error("Customer ID mismatch", {
          sessionCustomerId: customer,
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

      const paymentMethodId = setupIntent.payment_method as string;
      if (!paymentMethodId) {
        logger.warn("Setup intent missing payment method, skipping upgrade", {
          setupIntentId: setupIntent.id,
        });
        return;
      }

      logger.info("Upgrading trial subscription", {
        subscriptionId,
        customerId: customer,
        paymentMethodId,
        currentStatus: subscription.status,
      });

      // 1. Attach the payment method to the customer (if not already attached)
      try {
        await stripe.paymentMethods.attach(paymentMethodId, {
          customer: customer,
        });
        logger.info("Payment method attached to customer", {
          paymentMethodId,
          customerId: customer,
        });
      } catch (attachError) {
        // Payment method might already be attached, which is fine
        if (attachError instanceof Error && attachError.message.includes('already been attached')) {
          logger.info("Payment method already attached to customer", {
            paymentMethodId,
            customerId: customer,
          });
        } else {
          throw attachError;
        }
      }

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
      await eventBridgeClient.send(
        new PutEventsCommand({
          Entries: [
            {
              Source: "service.stripe",
              DetailType: "SetupIntentSucceeded",
              Detail: JSON.stringify({
                stripeSetupIntentId: setupIntent.id,
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
        }),
      );

      logger.info("SetupIntentSucceeded event sent", {
        setupIntentId: setupIntent.id,
        subscriptionId,
      });

      return; // Exit early for setup mode sessions
    }

    // Handle subscription mode sessions (existing logic)
    const { customer_details: customerDetails } = session;
    const customer = session.customer as Stripe.Customer;
    const subscription = session.subscription as Stripe.Subscription;

    if (!customer || !subscription) {
      logger.warn("Missing customer or subscription data, skipping", { sessionId });
      return;
    }

    const email = customerDetails?.email || customer.email;
    const now = new Date().toISOString();

    // Extract name from customer_details (Stripe's default billing name field)
    // Fallback order: payment intent billing name -> custom_fields.full_name (for trials) -> empty
    const paymentIntent = session.payment_intent as Stripe.PaymentIntent;
    const customFullName = session.custom_fields?.find(
      (field) => field.key === "full_name",
    )?.text?.value;
    const fullName =
      customerDetails?.name ||
      paymentIntent?.charges?.data?.[0]?.billing_details?.name ||
      customFullName ||
      (session.metadata as Record<string, unknown>)?.customer_name?.toString() ||
      "";
    const organizationField = session.custom_fields?.find(
      (field) => field.key === "organization",
    );
    const organization = organizationField?.text?.value || "";
    
    // Extract firstName and lastName from the billing name field
    const nameParts = fullName.trim().split(/\s+/);
    const firstName = nameParts[0] || "";
    const lastName = nameParts.slice(1).join(" ") || "";

    // Generate idempotency key for customer creation
    const eventId = generateEventId("customer-created", customer.id);
    
    // Check idempotency
    const idempotencyResult = await ensureIdempotency(
      { dynamoDBClient, tableName: idempotencyTableName, logger },
      eventId,
      { 
        customerId: customer.id,
        subscriptionId: subscription.id,
        email,
        organization
      }
    );

    if (idempotencyResult.isDuplicate) {
      logger.info("Customer creation already processed, skipping", { 
        customerId: customer.id,
        eventId 
      });
      return;
    }

    try {
      const planItem = subscription.items.data[0];
      if (!planItem) {
        logger.warn("No plan item found in subscription, skipping", { subscriptionId: subscription.id });
        return;
      }

      await eventBridgeClient.send(
        new PutEventsCommand({
          Entries: [
            {
              Source: "service.stripe",
              DetailType: "CustomerCreated",
              EventBusName: eventBusName,
              Detail: JSON.stringify({
                stripeCustomerId: customer.id,
                customerEmail: email,
                customerName: fullName,
                createdAt: Math.floor(Date.now() / 1000),
                customerData: {
                  id: customer.id,
                  email: email,
                  name: fullName,
                },
                userName: email,
                name: fullName,
                signUpDate: now,
                stripeSubscriptionId: subscription.id,
                subscriptionStatus: subscription.status,
                planId: planItem.plan.product,
                priceId: planItem.price.id,
                subscriptionStartDate: subscription.start_date
                  ? new Date(subscription.start_date * 1000).toISOString()
                  : "",
                currentPeriodEndDate: new Date(
                  planItem.current_period_end * 1000,
                ).toISOString(),
                currency: subscription.currency,
                trialEndDate: subscription.trial_end
                  ? new Date(subscription.trial_end * 1000).toISOString()
                  : "",
                cancelAtPeriodEnd: subscription.cancel_at_period_end,
                organization: organization,
                firstName: firstName,
                lastName: lastName,
                updatedAt: now,
              }),
            },
          ],
        }),
      );

      logger.info("Customer created event sent to EventBridge", {
        customerId: customer.id,
        subscriptionId: subscription.id,
        email,
        firstName,
        lastName,
      });
    } catch (error) {
      logger.error("Error sending event to EventBridge", { 
        error: error instanceof Error ? error.message : String(error),
        sessionId,
      });
      throw new Error("Failed to send event to EventBridge");
    }
  };
