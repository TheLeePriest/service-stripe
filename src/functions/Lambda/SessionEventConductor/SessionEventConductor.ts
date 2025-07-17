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
  async (event: EventBridgeEvent<string, unknown>) => {
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
      // Extract the Stripe event from the EventBridge event
      const stripeEvent = event.detail as Record<string, unknown>;
      const session = (stripeEvent.data &&
        typeof stripeEvent.data === "object" &&
        (stripeEvent.data as Record<string, unknown>).object) as
        | Record<string, unknown>
        | undefined;
      const sessionId = session?.id as string | undefined;
      // Prefer customer_email, fallback to customer (which is a Stripe customer ID)
      const userId =
        (session?.customer_email as string | undefined) ||
        (session?.customer as string | undefined);
      const stripeCustomerId = session?.customer as string | undefined;
      // Try to get resourcesAnalyzed from metadata, fallback to 1 if not present
      let resourcesAnalyzed: number | undefined = undefined;
      const metadata = session?.metadata as Record<string, unknown> | undefined;
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
        userId,
        stripeCustomerId,
        resourcesAnalyzed,
        hasAllRequiredFields: !!(
          sessionId &&
          userId &&
          stripeCustomerId &&
          resourcesAnalyzed
        ),
      });

      logger.debug("Full session event detail", {
        session: JSON.stringify(session, null, 2),
      });

      if (
        !sessionId ||
        !userId ||
        !stripeCustomerId ||
        typeof resourcesAnalyzed === "undefined"
      ) {
        logger.error("Missing required session event fields", {
          sessionId,
          userId,
          stripeCustomerId,
          resourcesAnalyzed,
        });
        throw new Error("Session event missing required fields");
      }

      // Create a mock Stripe session event structure for the sessionCompleted function
      const mockStripeEvent: Stripe.CheckoutSessionCompletedEvent.Data = {
        object: {
          id: sessionId,
          customer_details: {
            email: userId, // Use userId as email if possible
            name:
              (session?.customer_details as { name?: string })?.name ||
              (metadata?.name as string) ||
              "User",
          },
          customer: stripeCustomerId,
          metadata: metadata,
        } as Stripe.Checkout.Session,
      };

      // Process the session completion
      await sessionCompleted({
        stripe,
        eventBridgeClient,
        eventBusName,
        dynamoDBClient,
        idempotencyTableName,
        logger,
      })(mockStripeEvent);

      logger.info("Successfully processed session completion", {
        sessionId,
        userId,
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
