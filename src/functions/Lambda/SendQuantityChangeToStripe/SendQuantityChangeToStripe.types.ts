import type Stripe from "stripe";

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
      ) => Promise<Stripe.Response<Stripe.Subscription>>;
      retrieve: (id: string) => Promise<Stripe.Response<Stripe.Subscription>>;
    };
  };
};

export type LicenseQuantityChange = {
  licenseKey: string;
  itemId: string;
  stripeSubscriptionId: string;
};
