import type { InvoicePaymentSucceededEvent, InvoicePaymentSucceededDependencies } from "./InvoicePaymentSucceeded.types";
import { PutEventsCommand } from "@aws-sdk/client-eventbridge";
import type { Logger } from "../types/utils.types";
import { ensureIdempotency, generateEventId } from "../lib/idempotency";
import type Stripe from "stripe";

export const invoicePaymentSucceeded =
  ({
    stripe,
    eventBridgeClient,
    eventBusName,
    dynamoDBClient,
    idempotencyTableName,
    logger,
  }: InvoicePaymentSucceededDependencies & { logger: Logger }) =>
  async (event: InvoicePaymentSucceededEvent) => {
    const { id: stripeInvoiceId, customer, subscription, status, amount_paid, currency } = event.data.object;

    logger.logStripeEvent("invoice.payment_succeeded", event as unknown as Record<string, unknown>);

    // Generate idempotency key
    const eventId = generateEventId("invoice-payment-succeeded", stripeInvoiceId, event.created);
    
    // Check idempotency
    const idempotencyResult = await ensureIdempotency(
      { dynamoDBClient, tableName: idempotencyTableName, logger },
      eventId,
      { 
        invoiceId: stripeInvoiceId, 
        customerId: customer,
        subscriptionId: subscription,
        status,
        amountPaid: amount_paid,
        currency
      }
    );

    if (idempotencyResult.isDuplicate) {
      logger.info("Invoice payment already processed, skipping", { 
        invoiceId: stripeInvoiceId,
        eventId 
      });
      return;
    }

    try {
      // Retrieve customer details
      const customerData = await stripe.customers.retrieve(customer) as Stripe.Customer;

      logger.info("Processing invoice payment success", {
        invoiceId: stripeInvoiceId,
        customerId: customer,
        subscriptionId: subscription,
        status,
        amountPaid: amount_paid,
        currency,
      });

      // Send event to EventBridge
      await eventBridgeClient.send(
        new PutEventsCommand({
          Entries: [
            {
              Source: "service.stripe",
              DetailType: "InvoicePaymentSucceeded",
              EventBusName: eventBusName,
              Detail: JSON.stringify({
                stripeInvoiceId,
                stripeCustomerId: customer,
                customerEmail: customerData.email,
                subscriptionId: subscription,
                status,
                amountPaid: amount_paid,
                currency,
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

      logger.info("InvoicePaymentSucceeded event sent", { 
        invoiceId: stripeInvoiceId 
      });
    } catch (error) {
      logger.error("Error processing invoice payment success", {
        invoiceId: stripeInvoiceId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }; 