import type Stripe from "stripe";
import type { StripeLogger } from "../types/logger.types";

export type SendUsageToStripeDependencies = {
  stripeClient: {
    billing: {
      meterEvents: {
        create: (
          params: {
            event_name: string;
            payload: {
              stripe_customer_id: string;
              value: string;
            };
            identifier: string;
            timestamp: number;
          },
          options?: { idempotencyKey?: string }
        ) => Promise<Stripe.Response<unknown>>;
      };
    };
  };
  logger: StripeLogger;
};
