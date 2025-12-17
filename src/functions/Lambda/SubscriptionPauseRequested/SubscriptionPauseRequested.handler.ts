import Stripe from "stripe";
import { subscriptionPauseRequested } from "./SubscriptionPauseRequested";
import { createStripeLogger } from "../lib/logger/createLogger";
import { env } from "../lib/env";

const stripe = new Stripe(env.getRequired("STRIPE_SECRET_KEY", "Stripe secret key"), {
  apiVersion: "2025-04-30.basil",
});

const logger = createStripeLogger(
  "subscriptionPauseRequested",
  env.getRequired("STAGE") as "dev" | "prod" | "test",
);

export const subscriptionPauseRequestedHandler = subscriptionPauseRequested({
  stripeClient: stripe,
  logger,
});

