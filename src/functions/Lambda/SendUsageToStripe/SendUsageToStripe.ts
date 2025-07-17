import type { SQSEvent } from "aws-lambda";
import type { SendUsageToStripeDependencies } from "./SendUsageToStripe.types";

export const sendUsageToStripe =
  ({ stripeClient, logger }: SendUsageToStripeDependencies) =>
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
        const { stripeCustomerId, resourcesAnalyzed } = detail;

        logger.info("Extracted usage data", {
          stripeCustomerId: stripeCustomerId?.S,
          resourcesAnalyzed,
          hasRequiredFields: !!(stripeCustomerId?.S && resourcesAnalyzed),
        });

        if (!stripeCustomerId || !resourcesAnalyzed) {
          logger.warn("Missing fields, skipping record", { 
            recordBody: body,
            missingFields: {
              stripeCustomerId: !stripeCustomerId,
              resourcesAnalyzed: !resourcesAnalyzed,
            }
          });
          continue;
        }

        const meterEvent = {
          event_name: "pro_analysis_usage",
          payload: {
            stripe_customer_id: stripeCustomerId.S,
            value: resourcesAnalyzed,
          },
          identifier: record.messageId,
          timestamp: Math.floor(Date.now() / 1000),
        };

        logger.debug("Created meter event", {
          meterEvent,
        });

        meterEvents.push(meterEvent);

        logger.logUsageEvent(stripeCustomerId.S, {
          resourcesAnalyzed,
          messageId: record.messageId,
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
      })),
    });

    const results = await Promise.allSettled(
      meterEvents.map((event) => {
        const idempotencyKey = `usage-${event.identifier}-${event.timestamp}`;
        logger.debug("Sending meter event to Stripe", {
          event,
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
      })),
    });
  };
