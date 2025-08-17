import type { SQSEvent } from "aws-lambda";
import type { SendUsageToStripeDependencies } from "./SendUsageToStripe.types";

export const sendUsageToStripe =
  ({ stripeClient, logger, config }: SendUsageToStripeDependencies) =>
  async (event: SQSEvent) => {
    const meterEvents = [];

    logger.info("SendUsageToStripe handler invoked", {
      recordCount: event.Records.length,
      requestId: event.Records[0]?.attributes?.MessageDeduplicationId || "unknown",
    });

    logger.debug("Raw SQS event structure", {
      event: JSON.stringify(event, null, 2),
    });

    for (const record of event.Records) {
      try {
        logger.debug("Processing SQS record", {
          messageId: record.messageId,
          receiptHandle: record.receiptHandle,
          body: record.body,
        });

        const body = JSON.parse(record.body);
        logger.debug("Parsed record body", { 
          recordBody: body,
          hasDetail: !!body.detail,
          detailKeys: body.detail ? Object.keys(body.detail) : [],
        });

        const { detail } = body;
        const { 
          stripeCustomerId, 
          resourcesAnalyzed, 
          subscriptionType, 
          meteredPriceId,
          isOverusage,
          overusageAmount,
          licenseType
        } = detail;

        // Add detailed debugging to understand the data structure
        logger.debug("Raw stripeCustomerId structure", {
          stripeCustomerId,
          stripeCustomerIdType: typeof stripeCustomerId,
          stripeCustomerIdKeys: stripeCustomerId ? Object.keys(stripeCustomerId) : null,
        });

        logger.info("Extracted usage data", {
          stripeCustomerId,
          resourcesAnalyzed,
          subscriptionType,
          meteredPriceId,
          isOverusage,
          overusageAmount,
          licenseType,
          hasRequiredFields: !!(stripeCustomerId && resourcesAnalyzed),
        });

        if (!stripeCustomerId || !resourcesAnalyzed) {
          logger.warn("Missing required fields, skipping record", { 
            recordBody: body,
            missingFields: {
              stripeCustomerId: !stripeCustomerId,
              resourcesAnalyzed: !resourcesAnalyzed,
            },
            stripeCustomerId,
          });
          continue;
        }

        // Determine the correct event name and price ID based on subscription type
        let eventName: string;
        let priceId: string | undefined;

        if (subscriptionType === "TEAM" || subscriptionType === "ENTERPRISE") {
          // Enterprise/Team subscription - use Enterprise usage price
          eventName = "enterprise_analysis_usage";
          priceId = config.enterpriseUsagePriceId;
          
          logger.info("Using Enterprise usage price", {
            eventName,
            priceId,
            subscriptionType,
            isOverusage,
            overusageAmount,
          });
        } else {
          // Individual/Pro subscription - use Pro usage price
          eventName = "pro_analysis_usage";
          priceId = meteredPriceId;
          
          logger.info("Using Pro usage price", {
            eventName,
            priceId,
            subscriptionType,
            isOverusage,
            overusageAmount,
          });
        }

        // Always send meter events to Stripe for metered pricing
        // Stripe needs to know about ALL usage to track when customers hit tier limits (e.g., 10k resources)
        const meterEvent = {
          event_name: eventName,
          payload: {
            stripe_customer_id: stripeCustomerId,
            value: resourcesAnalyzed, // Always send the full resources analyzed for metered pricing
            ...(priceId && { price_id: priceId }), // Include price_id if available
          },
          identifier: record.messageId,
          timestamp: Math.floor(Date.now() / 1000),
        };

        // Validate that the required fields are present
        if (!meterEvent.payload.stripe_customer_id) {
          logger.error("Meter event payload missing stripe_customer_id", {
            meterEvent,
            stripeCustomerId,
            stripeCustomerIdType: typeof stripeCustomerId,
            payloadKeys: Object.keys(meterEvent.payload),
          });
          throw new Error("Meter event payload missing required stripe_customer_id field");
        }

        // Add detailed debugging for the meter event payload
        logger.debug("Created meter event with detailed payload info", {
          meterEvent,
          payloadKeys: Object.keys(meterEvent.payload),
          stripeCustomerIdInPayload: meterEvent.payload.stripe_customer_id,
          payloadStringified: JSON.stringify(meterEvent.payload),
          isOverusage,
          overusageAmount,
          resourcesAnalyzed,
        });

        meterEvents.push(meterEvent);

        logger.logUsageEvent(stripeCustomerId, {
          resourcesAnalyzed,
          messageId: record.messageId,
          subscriptionType,
          eventName,
          priceId,
          isOverusage,
          overusageAmount,
        });
      } catch (err) {
        logger.error("Failed to parse record body", {
          recordBody: record.body,
          error: err instanceof Error ? err.message : String(err),
          stack: err instanceof Error ? err.stack : undefined,
        });
      }
    }

    logger.info("Preparing to send meter events to Stripe", {
      eventCount: meterEvents.length,
      events: meterEvents.map(e => ({
        customerId: e.payload.stripe_customer_id,
        value: e.payload.value,
        identifier: e.identifier,
        eventName: e.event_name,
        priceId: e.payload.price_id,
      })),
    });

    const results = await Promise.allSettled(
      meterEvents.map((event) => {
        const idempotencyKey = `usage-${event.identifier}-${event.timestamp}`;
        
        // Add debugging to see the final event structure before sending
        logger.debug("Sending meter event to Stripe - final structure", {
          event,
          eventPayload: event.payload,
          payloadKeys: Object.keys(event.payload),
          stripeCustomerId: event.payload.stripe_customer_id,
          idempotencyKey,
        });
        
        return stripeClient.billing.meterEvents.create(event, {
          idempotencyKey,
        });
      }),
    );

    const failed = results.filter((r) => r.status === "rejected");
    if (failed.length > 0) {
      logger.error("Some meter events failed to send", {
        failedCount: failed.length,
        totalCount: meterEvents.length,
        failedResults: failed.map((r, i) => ({
          index: i,
          reason: r.status === "rejected" ? (r.reason as Error).message : "unknown",
        })),
      });
      throw new Error("Some meter events failed to send to Stripe.");
    }

    logger.info("Successfully sent meter events to Stripe", {
      sentCount: meterEvents.length,
      events: meterEvents.map(e => ({
        customerId: e.payload.stripe_customer_id,
        value: e.payload.value,
        eventName: e.event_name,
      })),
    });
  };
