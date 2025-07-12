import Stripe from "stripe";
import { sendQuantityChangeToStripe } from "./SendQuantityChangeToStripe";
import { createStripeLogger } from "../lib/logger/createLogger";
import { env } from "../lib/env";

const stripe = new Stripe(env.getRequired("STRIPE_SECRET_KEY", "Stripe secret key"), {
  apiVersion: "2025-04-30.basil",
});

const logger = createStripeLogger(
  "sendQuantityChangeToStripe",
  env.getRequired("STAGE") as "dev" | "prod" | "test"
);

export const sendQuantityChangeToStripeHandler = sendQuantityChangeToStripe({
  stripeClient: stripe,
  logger,
});
