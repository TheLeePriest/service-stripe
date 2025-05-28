import type {
  PutEventsCommand,
  PutEventsCommandOutput,
} from "@aws-sdk/client-eventbridge";
import type Stripe from "stripe";

export type SubscriptionDeletedDependencies = {
  stripe: {
    customers: {
      retrieve: (id: string) => Promise<Stripe.Customer>;
    };
  };
  eventBridgeClient: {
    send: (command: PutEventsCommand) => Promise<PutEventsCommandOutput>;
  };
  eventBusName: string;
};

export type SubscriptionDeletedEvent = {
  id: string;
  customer: string;
  status: string;
  ended_at?: number;
  canceled_at?: number;
};
