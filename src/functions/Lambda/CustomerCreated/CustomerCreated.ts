import type { EventBridgeEvent } from "aws-lambda";
import type Stripe from "stripe";
import type {
  CustomerCreatedEvent,
  CustomerCreatedDependencies,
} from "./CustomerCreated.types";
import { sendEvent } from "../lib/sendEvent";
import { ensureIdempotency, generateEventId } from "../lib/idempotency";

export const customerCreated =
  ({ eventBridgeClient, eventBusName, dynamoDBClient, idempotencyTableName, logger }: CustomerCreatedDependencies) =>
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
      eventId: event.id,
      detailType: event["detail-type"],
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
        customerCreated: customer.created,
      });

      if (!customer.id || !customer.email) {
        logger.error("Missing required customer fields", {
          customerId: customer.id,
          hasEmail: !!customer.email,
        });
        throw new Error("Customer missing required fields: id or email");
      }

      const customerId = customer.id;
      const customerEmail = customer.email;
      const customerMetadata = (customer.metadata ||
        {}) as Record<string, string | undefined>;
      const customerName =
        customer.name ||
        customerMetadata.customer_name;

      // If no name (common for trial signups), set empty string so downstream
      // email renders "Hi there..." and later upgrades can supply the real name.
      const resolvedName = customerName || "";

      // Check idempotency
      const eventId = generateEventId("customer-created", customerId, customer.created);
      const idempotencyResult = await ensureIdempotency(
        { dynamoDBClient, tableName: idempotencyTableName, logger },
        eventId,
        { customerId, email: customerEmail },
      );

      if (idempotencyResult.isDuplicate) {
        logger.info("Customer creation already processed, skipping", {
          customerId,
          eventId,
        });
        return;
      }

      logger.info("Processing customer creation", {
        customerId,
      });

      // Emit EventBridge event for downstream services
      const eventDetail = {
        stripeCustomerId: customerId,
        customerEmail: customerEmail,
        customerName: resolvedName,
        createdAt: customer.created,
        customerData: {
          id: customerId,
          email: customerEmail,
          name: resolvedName,
        },
        // Additional fields for other services
        customerId,
        email: customerEmail,
        name: resolvedName,
        metadata: customer.metadata,
      };

      logger.info("Emitting customer created event", {
        customerId,
        eventBusName,
      });

      await sendEvent(
        eventBridgeClient,
        [
          {
            Source: "service.stripe",
            DetailType: "CustomerCreated",
            Detail: JSON.stringify(eventDetail),
            EventBusName: eventBusName,
          },
        ],
        logger,
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