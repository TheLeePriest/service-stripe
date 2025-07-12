import type Stripe from "stripe";
import type { StripeClient } from "../../Lambda/types/stripe.types";
import type { Logger } from "../../Lambda/types/utils.types";

type GetCustomer = {
  stripeClient: StripeClient;
  customerId: string;
  logger: Logger;
};

export const getCustomer = async ({
  stripeClient,
  customerId,
  logger,
}: GetCustomer) => {
  try {
    const customer = await stripeClient.customers.retrieve(customerId);
    logger.debug("Retrieved customer", { customerId });
    return customer;
  } catch (error) {
    logger.error("Error retrieving customer", {
      customerId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw new Error(`Failed to retrieve customer: ${(error as Error).message}`);
  }
};
