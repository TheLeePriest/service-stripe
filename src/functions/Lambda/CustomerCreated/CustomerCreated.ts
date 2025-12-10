import type { EventBridgeEvent } from "aws-lambda";
import type Stripe from "stripe";
import type {
  CustomerCreatedEvent,
  CustomerCreatedDependencies,
} from "./CustomerCreated.types";
import { PutEventsCommand } from "@aws-sdk/client-eventbridge";

export const customerCreated =
  ({ eventBridgeClient, eventBusName, logger }: CustomerCreatedDependencies) =>
  async (event: EventBridgeEvent<"Stripe Event", Stripe.Event>) => {
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
      const stripeEvent = event.detail;

      if (stripeEvent.type !== "customer.created") {
        logger.info("Ignoring non customer.created event", {
          stripeEventType: stripeEvent.type,
        });
        return;
      }

      if (!stripeEvent.data?.object) {
        logger.error("Missing stripe event data.object", { stripeEventId: stripeEvent.id });
        throw new Error("Invalid Stripe event structure: missing data.object");
      }

      const customer = stripeEvent.data.object as Stripe.Customer;

      logger.info("Extracted customer data", {
        customerId: customer.id,
        customerEmail: customer.email,
        customerName: customer.name,
        customerCreated: customer.created,
        customerMetadata: customer.metadata,
      });

      if (!customer.id || !customer.email) {
        logger.error("Missing required customer fields", {
          customerId: customer.id,
          customerEmail: customer.email,
        });
        throw new Error("Customer missing required fields: id or email");
      }

      // Require a name; if absent, defer to session-completed flow that carries full_name
      if (!customer.name) {
        logger.warn("Customer name missing on customer.created; skipping user creation", {
          customerId: customer.id,
          customerEmail: customer.email,
        });
        return;
      }

      const customerId = customer.id;
      const customerEmail = customer.email;
      const customerName = customer.name;

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