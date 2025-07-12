import type { SQSEvent } from "aws-lambda";
import type { SendUsageToStripeDependencies } from "./SendUsageToStripe.types";

export const sendUsageToStripe =
  ({ stripeClient, logger }: SendUsageToStripeDependencies) =>
  async (event: SQSEvent) => {
    const meterEvents = [];

    logger.info("Processing SQS usage events", {
      recordCount: event.Records.length,
    });

    for (const record of event.Records) {
      try {
        const body = JSON.parse(record.body);
        logger.debug("Processing record", { recordBody: body });
        const { detail } = body;
        const { stripeCustomerId, resourcesAnalyzed } = detail;

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

        meterEvents.push({
          event_name: "pro_analysis_usage",
          payload: {
            stripe_customer_id: stripeCustomerId.S,
            value: resourcesAnalyzed,
          },
          identifier: record.messageId,
          timestamp: Math.floor(Date.now() / 1000),
        });

        logger.logUsageEvent(stripeCustomerId.S, {
          resourcesAnalyzed,
          messageId: record.messageId,
        });
      } catch (err) {
        logger.error("Failed to parse record body", {
          recordBody: record.body,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    logger.info("Sending meter events to Stripe", {
      eventCount: meterEvents.length,
    });

    const results = await Promise.allSettled(
      meterEvents.map((event) =>
        stripeClient.billing.meterEvents.create(event, {
          idempotencyKey: `usage-${event.identifier}-${event.timestamp}`,
        }),
      ),
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
    });
  };
