import type Stripe from "stripe";
import type { Logger } from "../types/utils.types";

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
              price_id?: string;
            };
            identifier: string;
            timestamp: number;
          },
          options?: { idempotencyKey?: string }
        ) => Promise<Stripe.Response<unknown>>;
      };
    };
  };
  logger: Logger;
  config: {
    enterpriseUsagePriceId?: string;
  };
};
