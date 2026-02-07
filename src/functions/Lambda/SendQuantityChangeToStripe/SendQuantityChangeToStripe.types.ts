import type Stripe from "stripe";
import type { Logger } from "../types/utils.types";

export type SendQuantityChangeToStripeDependencies = {
  stripeClient: {
    subscriptions: {
      update: (
        id: string,
        params: {
          items: Array<{
            id: string;
            quantity: number;
          }>;
        },
        options?: { idempotencyKey?: string }
      ) => Promise<Stripe.Response<Stripe.Subscription>>;
      retrieve: (id: string) => Promise<Stripe.Response<Stripe.Subscription>>;
    };
  };
  logger: Logger;
};

export type LicenseQuantityChange = {
  licenseKey: string;
  itemId: string;
  stripeSubscriptionId: string;
};
