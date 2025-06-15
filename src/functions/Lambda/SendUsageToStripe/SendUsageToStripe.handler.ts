import Stripe from "stripe";
import { sendUsageToStripe } from "./SendUsageToStripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string, {
  apiVersion: "2025-04-30.basil",
});

export const sendUsageToStripeHandler = sendUsageToStripe({
  stripeClient: stripe,
});
