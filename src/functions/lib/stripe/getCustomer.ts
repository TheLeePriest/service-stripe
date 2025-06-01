import type Stripe from "stripe";
import type { StripeClient } from "../../Lambda/types/stripe.types";

type GetCustomer = {
  stripeClient: StripeClient;
  customerId: string;
};

export const getCustomer = async ({
  stripeClient,
  customerId,
}: GetCustomer) => {
  try {
    return await stripeClient.customers.retrieve(customerId);
  } catch (error) {
    console.error("Error retrieving customer:", error);
    throw new Error(`Failed to retrieve customer: ${(error as Error).message}`);
  }
};
