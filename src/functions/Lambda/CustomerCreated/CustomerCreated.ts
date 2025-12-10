import type { EventBridgeEvent } from "aws-lambda";
import type { CustomerCreatedEvent, CustomerCreatedDependencies } from "./CustomerCreated.types";
import { PutEventsCommand } from "@aws-sdk/client-eventbridge";
import type { Logger } from "../types/utils.types";
import { ensureIdempotency, generateEventId } from "../lib/idempotency";
import type Stripe from "stripe";

export const customerCreated =
  ({ eventBridgeClient, eventBusName, stripeClient, logger }: CustomerCreatedDependencies) =>
  async (event: EventBridgeEvent<string, unknown>) => {
    logger.info("CustomerCreated handler invoked", {
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

      const customer = stripeData.object as Record<string, unknown>;
      
      logger.info("Extracted customer data", {
        customerId: customer.id,
        customerEmail: customer.email,
        customerName: customer.name,
        customerCreated: customer.created,
        customerMetadata: customer.metadata,
      });

      logger.debug("Full customer object", {
        customer: JSON.stringify(customer, null, 2),
      });

      if (!customer.id || !customer.email) {
        logger.error("Missing required customer fields", {
          customerId: customer.id,
          customerEmail: customer.email,
        });
        throw new Error("Customer missing required fields: id or email");
      }

      const customerId = customer.id as string;
      const customerEmail = customer.email as string;
      const customerMetadata = (customer.metadata ||
        {}) as Record<string, string | undefined>;
      const customerName =
        (customer.name as string | undefined) ||
        customerMetadata.customer_name ||
        customerEmail;

      logger.info("Processing customer creation", {
        customerId,
        customerEmail,
        customerName,
      });

      // Emit EventBridge event for downstream services
      const eventDetail = {
        stripeCustomerId: customerId,
        customerEmail: customerEmail,
        customerName: customerName,
        createdAt: customer.created,
        customerData: {
          id: customerId,
          email: customerEmail,
          name: customerName,
        },
        // Additional fields for other services
        customerId,
        email: customerEmail,
        name: customerName,
        metadata: customer.metadata,
      };

      logger.info("Emitting customer created event", {
        eventDetail,
        eventBusName,
      });

      await eventBridgeClient.send(
        new PutEventsCommand({
          Entries: [
            {
              Source: "service.stripe",
              DetailType: "CustomerCreated",
              Detail: JSON.stringify(eventDetail),
              EventBusName: eventBusName,
            },
          ],
        })
      );

      logger.info("Successfully emitted customer created event", {
        customerId,
        eventBusName,
      });

    } catch (error) {
      logger.error("Error processing customer created event", {
        eventId: event.id,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      throw error;
    }
  }; 