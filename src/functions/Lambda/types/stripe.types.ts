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
  };
  prices: {
    retrieve: (id: string) => Promise<Stripe.Response<Stripe.Price>>;
  };
};
