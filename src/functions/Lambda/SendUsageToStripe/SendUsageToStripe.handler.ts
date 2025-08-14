import Stripe from "stripe";
import { sendUsageToStripe } from "./SendUsageToStripe";
import { createStripeLogger } from "../lib/logger/createLogger";
import { env } from "../lib/env";

const stripe = new Stripe(env.getRequired("STRIPE_SECRET_KEY", "Stripe secret key"), {
  apiVersion: "2025-04-30.basil",
});

const logger = createStripeLogger(
  "sendUsageToStripe",
  env.getRequired("STAGE") as "dev" | "prod" | "test"
);

export const sendUsageToStripeHandler = sendUsageToStripe({
  stripeClient: stripe,
  logger,
  config: {
    enterpriseUsagePriceId: env.get("STRIPE_ENTERPRISE_USAGE_PRICE_ID"),
  },
});
