import type { InvoicePaymentFailedEvent, InvoicePaymentFailedDependencies } from "./InvoicePaymentFailed.types";
import { PutEventsCommand } from "@aws-sdk/client-eventbridge";
import type { Logger } from "../types/utils.types";
import { ensureIdempotency, generateEventId } from "../lib/idempotency";
import type Stripe from "stripe";

export const invoicePaymentFailed =
  ({
    stripe,
    eventBridgeClient,
    eventBusName,
    dynamoDBClient,
    idempotencyTableName,
    logger,
  }: InvoicePaymentFailedDependencies & { logger: Logger }) =>
  async (event: InvoicePaymentFailedEvent) => {
    const { id: stripeInvoiceId, customer, subscription, status, amount_due, currency, attempt_count } = event.data.object;

    logger.logStripeEvent("invoice.payment_failed", event as unknown as Record<string, unknown>);

    // Generate idempotency key
    const eventId = generateEventId("invoice-payment-failed", stripeInvoiceId, event.created);
    
    // Check idempotency
    const idempotencyResult = await ensureIdempotency(
      { dynamoDBClient, tableName: idempotencyTableName, logger },
      eventId,
      { 
        invoiceId: stripeInvoiceId, 
        customerId: customer,
        subscriptionId: subscription,
        status,
        amountDue: amount_due,
        currency,
        attemptCount: attempt_count
      }
    );

    if (idempotencyResult.isDuplicate) {
      logger.info("Invoice payment failure already processed, skipping", { 
        invoiceId: stripeInvoiceId,
        eventId 
      });
      return;
    }

    try {
      // Retrieve customer details
      const customerData = await stripe.customers.retrieve(customer) as Stripe.Customer;

      logger.info("Processing invoice payment failure", {
        invoiceId: stripeInvoiceId,
        customerId: customer,
        subscriptionId: subscription,
        status,
        amountDue: amount_due,
        currency,
        attemptCount: attempt_count,
      });

      // Send event to EventBridge
      await eventBridgeClient.send(
        new PutEventsCommand({
          Entries: [
            {
              Source: "service.stripe",
              DetailType: "InvoicePaymentFailed",
              EventBusName: eventBusName,
              Detail: JSON.stringify({
                stripeInvoiceId,
                stripeCustomerId: customer,
                customerEmail: customerData.email,
                subscriptionId: subscription,
                status,
                amountDue: amount_due,
                currency,
                attemptCount: attempt_count,
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

      logger.info("InvoicePaymentFailed event sent", { 
        invoiceId: stripeInvoiceId 
      });
    } catch (error) {
      logger.error("Error processing invoice payment failure", {
        invoiceId: stripeInvoiceId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }; 