import type { EventBridgeEvent } from "aws-lambda";
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
  async (event: EventBridgeEvent<string, unknown>) => {
    logger.info("PaymentMethodAttached handler invoked", {
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

      const paymentMethod = stripeData.object as Record<string, unknown>;
      
      logger.info("Extracted payment method data", {
        paymentMethodId: paymentMethod.id,
        customerId: paymentMethod.customer,
        type: paymentMethod.type,
        card: paymentMethod.card,
        created: paymentMethod.created,
      });

      logger.debug("Full payment method object", {
        paymentMethod: JSON.stringify(paymentMethod, null, 2),
      });

      if (!paymentMethod.id || !paymentMethod.customer || !paymentMethod.type) {
        logger.error("Missing required payment method fields", {
          paymentMethodId: paymentMethod.id,
          customerId: paymentMethod.customer,
          type: paymentMethod.type,
        });
        throw new Error("Payment method missing required fields: id, customer, or type");
      }

      const paymentMethodId = paymentMethod.id as string;
      const customer = paymentMethod.customer as string;
      const type = paymentMethod.type as string;
      const card = paymentMethod.card as Record<string, unknown> | undefined;
      const created = paymentMethod.created as number;

      logger.logStripeEvent("payment_method.attached", stripeEvent as Record<string, unknown>);

      // Generate idempotency key
      const eventId = generateEventId("payment-method-attached", paymentMethodId, created);
      
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

      // Retrieve customer details
      const customerData = await stripe.customers.retrieve(customer) as Stripe.Customer;

      logger.info("Processing payment method attachment", {
        paymentMethodId,
        customerId: customer,
        type,
      });

      // Note: Trial upgrades are now handled via SetupIntentSucceeded handler
      // when users go through Stripe Checkout in setup mode

      // Send event to EventBridge
      await eventBridgeClient.send(
        new PutEventsCommand({
          Entries: [
            {
              Source: "service.stripe",
              DetailType: "PaymentMethodAttached",
              Detail: JSON.stringify({
                stripePaymentMethodId: paymentMethodId,
                stripeCustomerId: customer,
                customerEmail: customerData.email,
                type,
                card,
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

      logger.info("PaymentMethodAttached event sent", { 
        paymentMethodId 
      });
    } catch (error) {
      logger.error("Error processing payment method attachment", {
        eventId: event.id,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      throw error;
    }
  }; 