import type {
  PutEventsCommand,
  PutEventsCommandOutput,
} from "@aws-sdk/client-eventbridge";
import type Stripe from "stripe";

export type SubscriptionCreatedDependencies = {
  stripe: {
    customers: {
      retrieve: (id: string) => Promise<Stripe.Customer>;
    };
    products: {
      retrieve: (product: string) => Promise<Stripe.Product>;
    };
  };
  uuidv4: () => string;
  eventBridgeClient: {
    send: (command: PutEventsCommand) => Promise<PutEventsCommandOutput>;
  };
  eventBusName: string;
};

export type SubscriptionCreatedEvent = {
  items: {
    data: Array<{
      price: { product: string; id: string };
      quantity: number;
      current_period_end: number;
      metadata?: Stripe.Metadata;
    }>;
  };
  customer: string;
  id: string;
  status: Stripe.Subscription.Status;
  cancel_at_period_end: boolean;
  trial_start?: number | null;
  trial_end?: number | null;
  created: number;
};
