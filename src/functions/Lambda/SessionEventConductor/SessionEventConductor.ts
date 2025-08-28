import type { EventBridgeEvent } from "aws-lambda";
import type { SessionEventConductorDependencies } from "./SessionEventConductor.types.ts";
import { sessionCompleted } from "../SessionCompleted/SessionCompleted";
import type Stripe from "stripe";

export const sessionEventConductor =
  ({
    stripe,
    eventBridgeClient,
    eventBusName,
    dynamoDBClient,
    idempotencyTableName,
    logger,
  }: SessionEventConductorDependencies) =>
  async (event: EventBridgeEvent<string, Stripe.CheckoutSessionCompletedEvent>) => {
    console.log("event", JSON.stringify(event));
    logger.info("SessionEventConductor invoked", {
      eventId: event.id,
      source: event.source,
      detailType: event["detail-type"],
      time: event.time,
      region: event.region,
      account: event.account,
    });

    logger.debug("Raw session event structure", {
      event: JSON.stringify(event, null, 2),
    });

    try {
      const stripeEvent = event.detail
      const session = stripeEvent.data;
      const sessionId = session.object.id;
      const customerEmail = session.object.customer_details?.email;
      const stripeCustomerId = session.object.customer;

      let resourcesAnalyzed: number | undefined = undefined;
      const metadata = session?.object.metadata;
      
      if (metadata && typeof metadata.resourcesAnalyzed !== "undefined") {
        const val = metadata.resourcesAnalyzed;
        resourcesAnalyzed =
          typeof val === "number" ? val : Number.parseInt(val as string, 10);
        if (Number.isNaN(resourcesAnalyzed)) resourcesAnalyzed = undefined;
      }

      // If not present, fallback to 1 (single license/session)
      if (typeof resourcesAnalyzed === "undefined") {
        resourcesAnalyzed = 1;
      }

      logger.info("Extracted session event detail", {
        sessionId,
        stripeCustomerId,
        resourcesAnalyzed,
        hasAllRequiredFields: !!(
          sessionId &&
          customerEmail &&
          stripeCustomerId &&
          resourcesAnalyzed
        ),
      });

      logger.debug("Full session event detail", {
        session: JSON.stringify(session, null, 2),
      });

      if (
        !sessionId ||
        !customerEmail ||
        !stripeCustomerId ||
        typeof resourcesAnalyzed === "undefined"
      ) {
        logger.error("Missing required session event fields", {
          sessionId,
          stripeCustomerId,
          resourcesAnalyzed,
        });
        throw new Error("Session event missing required fields");
      }

      await sessionCompleted({
        stripe,
        eventBridgeClient,
        eventBusName,
        dynamoDBClient,
        idempotencyTableName,
        logger,
      })(stripeEvent.data);

      logger.info("Successfully processed session completion", {
        sessionId,
        stripeCustomerId,
        resourcesAnalyzed,
      });
    } catch (error) {
      logger.error("Error processing session event", {
        eventId: event.id,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      throw error;
    }
  };
