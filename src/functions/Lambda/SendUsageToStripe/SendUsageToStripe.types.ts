import type Stripe from "stripe";

export type SendUsageToStripeDependencies = {
  stripeClient: {
    billing: {
      meterEvents: {
        create: (params: {
          event_name: string;
          payload: {
            stripe_customer_id: string;
            value: string;
          };
          identifier: string;
          timestamp: number;
        }) => Promise<Stripe.Response<unknown>>;
      };
    };
  };
};
