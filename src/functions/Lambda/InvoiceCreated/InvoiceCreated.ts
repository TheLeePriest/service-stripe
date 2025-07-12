import type { InvoiceCreatedEvent, InvoiceCreatedDependencies } from "./InvoiceCreated.types";
import { PutEventsCommand } from "@aws-sdk/client-eventbridge";
import type { Logger } from "../types/utils.types";
import { ensureIdempotency, generateEventId } from "../lib/idempotency";
import type Stripe from "stripe";

export const invoiceCreated =
  ({
    stripe,
    eventBridgeClient,
    eventBusName,
    dynamoDBClient,
    idempotencyTableName,
    logger,
  }: InvoiceCreatedDependencies & { logger: Logger }) =>
  async (event: InvoiceCreatedEvent) => {
    const { id: stripeInvoiceId, customer, status, amount_due, currency } = event.data.object;

    logger.logStripeEvent("invoice.created", event as unknown as Record<string, unknown>);

    // Generate idempotency key
    const eventId = generateEventId("invoice-created", stripeInvoiceId, event.created);
    
    // Check idempotency
    const idempotencyResult = await ensureIdempotency(
      { dynamoDBClient, tableName: idempotencyTableName, logger },
      eventId,
      { 
        invoiceId: stripeInvoiceId, 
        customerId: customer,
        status,
        amountDue: amount_due,
        currency
      }
    );

    if (idempotencyResult.isDuplicate) {
      logger.info("Invoice already processed, skipping", { 
        invoiceId: stripeInvoiceId,
        eventId 
      });
      return;
    }

    try {
      // Retrieve customer details
      const customerData = await stripe.customers.retrieve(customer) as Stripe.Customer;

      logger.info("Processing invoice creation", {
        invoiceId: stripeInvoiceId,
        customerId: customer,
        status,
        amountDue: amount_due,
        currency,
      });

      // Send event to EventBridge
      await eventBridgeClient.send(
        new PutEventsCommand({
          Entries: [
            {
              Source: "service.stripe",
              DetailType: "InvoiceCreated",
              EventBusName: eventBusName,
              Detail: JSON.stringify({
                stripeInvoiceId,
                stripeCustomerId: customer,
                customerEmail: customerData.email,
                status,
                amountDue: amount_due,
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

      logger.info("InvoiceCreated event sent", { 
        invoiceId: stripeInvoiceId 
      });
    } catch (error) {
      logger.error("Error processing invoice creation", {
        invoiceId: stripeInvoiceId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }; 