import type Stripe from "stripe";
import type { SessionCompletedDependencies } from "./SessionCompleted.types";
import { sendEvent } from "../lib/sendEvent";
import { ensureIdempotency, generateEventId } from "../lib/idempotency";

export const sessionCompleted =
  ({ stripe, eventBridgeClient, eventBusName, logger, dynamoDBClient, idempotencyTableName }: SessionCompletedDependencies) =>
  async (event: Stripe.CheckoutSessionCompletedEvent.Data) => {
    const { object } = event;

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
        "custom_fields",
        "customer_details",
      ],
    });

    // Skip setup mode sessions - these are handled synchronously by the complete-upgrade API endpoint
    // The subscription update will trigger customer.subscription.updated events which will sync DynamoDB
    if (session.mode === 'setup') {
      logger.info("Skipping setup mode session - handled by complete-upgrade API endpoint", {
        sessionId,
        customerId: session.customer,
      });
      return;
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
    // Fallback order: customer_details.name -> custom_fields.full_name (for trials) -> metadata -> empty
    const customFullName = session.custom_fields?.find(
      (field) => field.key === "full_name",
    )?.text?.value;
    const fullName =
      customerDetails?.name ||
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

    // Check if this is a beta tester (passed via session metadata)
    const isBetaTester = (session.metadata as Record<string, unknown>)?.is_beta_tester === 'true';

    // Update Stripe customer with name if we have one and it's not already set
    if (fullName && !customer.name) {
      try {
        await stripe.customers.update(customer.id, {
          name: fullName,
        });
        logger.info("Updated Stripe customer with name", {
          customerId: customer.id,
        });
      } catch (updateError) {
        logger.warn("Failed to update Stripe customer name", {
          customerId: customer.id,
          error: updateError instanceof Error ? updateError.message : String(updateError),
        });
        // Don't fail the entire flow if name update fails
      }
    }

    // Copy beta tester flag to subscription metadata for later reference
    if (isBetaTester) {
      try {
        await stripe.subscriptions.update(subscription.id, {
          metadata: { is_beta_tester: 'true' },
        });
        logger.info("Updated subscription with beta tester flag", {
          subscriptionId: subscription.id,
        });
      } catch (updateError) {
        logger.warn("Failed to update subscription with beta tester flag", {
          subscriptionId: subscription.id,
          error: updateError instanceof Error ? updateError.message : String(updateError),
        });
        // Don't fail the entire flow if metadata update fails
      }
    }

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

      await sendEvent(
        eventBridgeClient,
        [
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
              isBetaTester: isBetaTester,
            }),
          },
        ],
        logger,
      );

      logger.info("Customer created event sent to EventBridge", {
        customerId: customer.id,
        subscriptionId: subscription.id,
      });
    } catch (error) {
      logger.error("Error sending event to EventBridge", { 
        error: error instanceof Error ? error.message : String(error),
        sessionId,
      });
      throw new Error("Failed to send event to EventBridge");
    }
  };
