import Stripe from "stripe";
import { sendQuantityChangeToStripe } from "./SendQuantityChangeToStripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string, {
  apiVersion: "2025-04-30.basil",
});

export const sendQuantityChangeToStripeHandler = sendQuantityChangeToStripe({
  stripeClient: stripe,
});
