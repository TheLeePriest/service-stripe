import type Stripe from "stripe";
import type { SessionCompletedDependencies } from "./SessionCompleted.types";
import { PutEventsCommand } from "@aws-sdk/client-eventbridge";
import type { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import type { Logger } from "../types/utils.types";
import { ensureIdempotency, generateEventId } from "../lib/idempotency";

export const sessionCompleted =
  ({ stripe, eventBridgeClient, eventBusName, logger, dynamoDBClient, idempotencyTableName }: SessionCompletedDependencies & { 
    logger: Logger;
    dynamoDBClient: DynamoDBClient;
    idempotencyTableName: string;
  }) =>
  async (event: Stripe.CheckoutSessionCompletedEvent.Data) => {
    const { object } = event;

    logger.logStripeEvent("checkout.session.completed", event as unknown as Record<string, unknown>);

    if (!object) {
      logger.warn("Missing session data, skipping", { event });
      return;
    }

    const sessionId = object.id;
    const session = await stripe.checkout.sessions.retrieve(sessionId, {
      expand: ["customer", "subscription", "subscription.items.data.price"],
    });

    const { customer_details: customerDetails } = session;
    const customer = session.customer as Stripe.Customer;
    const subscription = session.subscription as Stripe.Subscription;

    if (!customer || !subscription) {
      logger.warn("Missing customer or subscription data, skipping", { sessionId });
      return;
    }

    const email = customerDetails?.email || customer.email;
    const organization = customerDetails?.name || customer.name || "";
    const now = new Date().toISOString();

    // Extract firstName and lastName from customer name
    const fullName = customer.name || customerDetails?.name || "";
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
                customerName: customer.name,
                createdAt: Math.floor(Date.now() / 1000),
                customerData: {
                  id: customer.id,
                  email: email,
                  name: customer.name,
                },
                // Additional fields for other services
                userName: email,
                name: customer.name,
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
