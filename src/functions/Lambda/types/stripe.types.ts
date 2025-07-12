import type Stripe from "stripe";

export type StripeClient = {
  customers: {
    retrieve: (
      id: string,
    ) => Promise<Stripe.Response<Stripe.Customer | Stripe.DeletedCustomer>>;
  };
  products: {
    retrieve: (id: string) => Promise<Stripe.Response<Stripe.Product>>;
  };
  subscriptions: {
    retrieve: (id: string) => Promise<Stripe.Response<Stripe.Subscription>>;
    update: (
      id: string,
      params: Stripe.SubscriptionUpdateParams,
      options?: { idempotencyKey?: string }
    ) => Promise<Stripe.Response<Stripe.Subscription>>;
  };
  prices: {
    retrieve: (id: string) => Promise<Stripe.Response<Stripe.Price>>;
  };
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
