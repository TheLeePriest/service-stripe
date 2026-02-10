import { sendUsageToStripe } from "./SendUsageToStripe";
import { createStripeLogger } from "../lib/logger/createLogger";
import { getStripeClient } from "../lib/stripeClient";
import { env } from "../lib/env";
import type { SQSEvent } from "aws-lambda";

const logger = createStripeLogger(
  "sendUsageToStripe",
  env.getRequired("STAGE") as "dev" | "prod" | "test"
);

let handler: ReturnType<typeof sendUsageToStripe> | undefined;

export const sendUsageToStripeHandler = async (event: SQSEvent) => {
  if (!handler) {
    const stripe = await getStripeClient(env.getRequired("STAGE"));
    handler = sendUsageToStripe({
      stripeClient: stripe,
      logger,
    });
  }
  return handler(event);
};
