import type { EventBridgeEvent } from "aws-lambda";
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
  async (event: EventBridgeEvent<string, unknown>) => {
    logger.info("InvoiceCreated handler invoked", {
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

      const invoice = stripeData.object as Record<string, unknown>;
      
      logger.info("Extracted invoice data", {
        invoiceId: invoice.id,
        customerId: invoice.customer,
        status: invoice.status,
        amountDue: invoice.amount_due,
        currency: invoice.currency,
        created: invoice.created,
      });

      logger.debug("Full invoice object", {
        invoice: JSON.stringify(invoice, null, 2),
      });

      // Check for required fields with proper field name mapping
      const stripeInvoiceId = invoice.id as string;
      const customer = invoice.customer as string;
      const status = invoice.status as string;
      const amount_due = invoice.amount_due as number;
      const currency = invoice.currency as string;
      const created = invoice.created as number;

      if (!stripeInvoiceId || !customer || !status || amount_due === undefined || !currency) {
        logger.error("Missing required invoice fields", {
          invoiceId: stripeInvoiceId,
          customerId: customer,
          status: status,
          amountDue: amount_due,
          currency: currency,
        });
        throw new Error("Invoice missing required fields: id, customer, status, amount_due, or currency");
      }

      logger.logStripeEvent("invoice.created", stripeEvent as Record<string, unknown>);

      // Generate idempotency key
      const eventId = generateEventId("invoice-created", stripeInvoiceId, created);
      
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
              Detail: JSON.stringify({
                stripeInvoiceId,
                stripeCustomerId: customer,
                customerEmail: customerData.email,
                status,
                amountDue: amount_due,
                currency,
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

      logger.info("InvoiceCreated event sent", { 
        invoiceId: stripeInvoiceId 
      });
    } catch (error) {
      logger.error("Error processing invoice creation", {
        eventId: event.id,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      throw error;
    }
  }; 