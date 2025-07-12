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
  async (event: PaymentMethodAttachedEvent) => {
    const { id: paymentMethodId, customer, type, card, created } = event.data.object;

    logger.logStripeEvent("payment_method.attached", event as unknown as Record<string, unknown>);

    // Generate idempotency key
    const eventId = generateEventId("payment-method-attached", paymentMethodId, event.created);
    
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

    try {
      // Retrieve customer details
      const customerData = await stripe.customers.retrieve(customer) as Stripe.Customer;

      logger.info("Processing payment method attachment", {
        paymentMethodId,
        customerId: customer,
        type,
      });

      // Send event to EventBridge
      await eventBridgeClient.send(
        new PutEventsCommand({
          Entries: [
            {
              Source: "service.stripe",
              DetailType: "PaymentMethodAttached",
              EventBusName: eventBusName,
              Detail: JSON.stringify({
                stripePaymentMethodId: paymentMethodId,
                stripeCustomerId: customer,
                customerEmail: customerData.email,
                type,
                card,
                createdAt: event.created,
                customerData: {
                  id: customerData.id,
                  email: customerData.email,
                  name: customerData.name,
                },
              }),
            },
          ],
        }),
      );

      logger.info("PaymentMethodAttached event sent", { 
        paymentMethodId 
      });
    } catch (error) {
      logger.error("Error processing payment method attachment", {
        paymentMethodId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }; 