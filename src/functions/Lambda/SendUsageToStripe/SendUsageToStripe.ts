import type { SQSEvent } from "aws-lambda";
import type { SendUsageToStripeDependencies } from "./SendUsageToStripe.types";

// ============================================================================
// PRICE ID RESOLUTION
// ============================================================================

/**
 * Resolves the correct price ID for the usage event.
 * For TEAM/ENTERPRISE subscriptions, uses the enterprise price.
 * For PRO subscriptions, uses the provided meteredPriceId.
 */
const resolvePriceId = (
  subscriptionType: string | undefined,
  meteredPriceId: string | undefined,
  enterpriseUsagePriceId: string | undefined
): string | undefined => {
  if (subscriptionType === "TEAM" || subscriptionType === "ENTERPRISE") {
    return enterpriseUsagePriceId;
  }
  return meteredPriceId;
};

// ============================================================================
// MAIN HANDLER
// ============================================================================

export const sendUsageToStripe =
  ({ stripeClient, logger, config }: SendUsageToStripeDependencies) =>
  async (event: SQSEvent) => {
    const meterEvents = [];

    logger.info("SendUsageToStripe handler invoked", {
      recordCount: event.Records.length,
    });

    for (const record of event.Records) {
      try {
        const body = JSON.parse(record.body);
        const { detail } = body;
        
        const { 
          stripeCustomerId, 
          resourcesAnalyzed, 
          subscriptionType, 
          meteredPriceId,
        } = detail;

        // Validate required fields
        if (!stripeCustomerId || !resourcesAnalyzed) {
          logger.warn("Missing required fields, skipping record", { 
            missingFields: {
              stripeCustomerId: !stripeCustomerId,
              resourcesAnalyzed: !resourcesAnalyzed,
            },
          });
          continue;
        }

        // Resolve price ID
        const priceId = resolvePriceId(
          subscriptionType,
          meteredPriceId,
          config.enterpriseUsagePriceId
        );

        // Create meter event
        const meterEvent = {
          event_name: 'cdk_insights_usage',
          payload: {
            stripe_customer_id: stripeCustomerId,
            value: String(resourcesAnalyzed),
            ...(priceId && { price_id: priceId }),
          },
          identifier: record.messageId,
          timestamp: Math.floor(Date.now() / 1000),
        };

        meterEvents.push(meterEvent);

        logger.info("Usage event prepared", {
          stripeCustomerId,
          resourcesAnalyzed,
          messageId: record.messageId,
          subscriptionType,
          eventName: 'cdk_insights_usage',
          priceId,
        });
      } catch (err) {
        logger.error("Failed to parse record body", {
          recordBody: record.body,
          error: err instanceof Error ? err.message : String(err),
          stack: err instanceof Error ? err.stack : undefined,
        });
      }
    }

    // Send all events to Stripe
    if (meterEvents.length === 0) {
      logger.info("No valid meter events to send");
      return;
    }

    const results = await Promise.allSettled(
      meterEvents.map((event) => {
        const idempotencyKey = `usage-${event.identifier}-${event.timestamp}`;
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
        failedReasons: failed.map((r) => 
          r.status === "rejected" ? (r.reason as Error).message : "unknown"
        ),
      });
      throw new Error("Some meter events failed to send to Stripe.");
    }

    logger.info("Successfully sent meter events to Stripe", {
      sentCount: meterEvents.length,
    });
  };
