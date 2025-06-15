import type { SQSEvent } from "aws-lambda";
import type { SendUsageToStripeDependencies } from "./SendUsageToStripe.types";

export const sendUsageToStripe =
  ({ stripeClient }: SendUsageToStripeDependencies) =>
  async (event: SQSEvent) => {
    const meterEvents = [];

    for (const record of event.Records) {
      try {
        const body = JSON.parse(record.body);
        console.log("Processing record:", body);
        const { detail } = body;
        const { stripeCustomerId, resourcesAnalyzed } = detail;

        if (!stripeCustomerId || !resourcesAnalyzed) {
          console.warn("Missing fields, skipping:", body);
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
      } catch (err) {
        console.error("Failed to parse record body:", record.body, err);
      }
    }

    const results = await Promise.allSettled(
      meterEvents.map((event) =>
        stripeClient.billing.meterEvents.create(event),
      ),
    );

    const failed = results.filter((r) => r.status === "rejected");
    if (failed.length > 0) {
      console.error(`${failed.length} meter events failed to send.`);
      throw new Error("Some meter events failed to send to Stripe.");
    }

    console.info(
      `Successfully sent ${meterEvents.length} meter events to Stripe`,
    );
  };
