import { sendQuantityChangeToStripe } from "./SendQuantityChangeToStripe";
import { createStripeLogger } from "../lib/logger/createLogger";
import { getStripeClient } from "../lib/stripeClient";
import { env } from "../lib/env";
import type { EventBridgeEvent } from "aws-lambda";
import type { LicenseQuantityChange } from "./SendQuantityChangeToStripe.types";

const logger = createStripeLogger(
  "sendQuantityChangeToStripe",
  env.getRequired("STAGE") as "dev" | "prod" | "test"
);

let handler: ReturnType<typeof sendQuantityChangeToStripe> | undefined;

export const sendQuantityChangeToStripeHandler = async (
  event: EventBridgeEvent<"LicenseCancelled" | "LicenseUncancelled", LicenseQuantityChange>,
) => {
  if (!handler) {
    const stripe = await getStripeClient(env.getRequired("STAGE"));
    handler = sendQuantityChangeToStripe({
      stripeClient: stripe,
      logger,
    });
  }
  return handler(event);
};
