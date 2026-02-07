import type Stripe from "stripe";

export type StripeClient = {
  customers: {
    retrieve: (
      id: string,
    ) => Promise<Stripe.Response<Stripe.Customer | Stripe.DeletedCustomer>>;
    update: (
      id: string,
      params: Stripe.CustomerUpdateParams,
    ) => Promise<Stripe.Response<Stripe.Customer>>;
  };
  products: {
    retrieve: (id: string) => Promise<Stripe.Response<Stripe.Product>>;
  };
  subscriptions: {
    retrieve: (
      id: string,
      params?: Stripe.SubscriptionRetrieveParams,
    ) => Promise<Stripe.Response<Stripe.Subscription>>;
    update: (
      id: string,
      params: Stripe.SubscriptionUpdateParams,
      options?: { idempotencyKey?: string },
    ) => Promise<Stripe.Response<Stripe.Subscription>>;
    list: (
      params: Stripe.SubscriptionListParams,
    ) => Promise<Stripe.Response<Stripe.ApiList<Stripe.Subscription>>>;
    cancel: (
      id: string,
      params?: Stripe.SubscriptionCancelParams,
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
        options?: { idempotencyKey?: string },
      ) => Promise<Stripe.Response<unknown>>;
    };
  };
  paymentMethods: {
    attach: (
      id: string,
      params: Stripe.PaymentMethodAttachParams,
    ) => Promise<Stripe.Response<Stripe.PaymentMethod>>;
  };
  refunds: {
    list: (
      params: Stripe.RefundListParams,
    ) => Promise<Stripe.Response<Stripe.ApiList<Stripe.Refund>>>;
  };
  checkout: {
    sessions: {
      retrieve: (
        id: string,
        params?: Stripe.Checkout.SessionRetrieveParams,
      ) => Promise<Stripe.Response<Stripe.Checkout.Session>>;
    };
  };
};
