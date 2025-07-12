import Stripe from "stripe";
import type { StripeClient } from "../../types/stripe.types";

// Configure Stripe client with optimized settings
const createStripeClient = (apiKey: string): StripeClient => {
  return new Stripe(apiKey, {
    apiVersion: "2025-04-30.basil",
    // Enable connection reuse
    maxNetworkRetries: 3,
    // Optimize for Lambda environment
    timeout: 30000,
  }) as StripeClient;
};

export const getCustomer = async (
  stripeClient: StripeClient,
  customerId: string
): Promise<Stripe.Customer> => {
  return (await stripeClient.customers.retrieve(customerId)) as Stripe.Customer;
}; 