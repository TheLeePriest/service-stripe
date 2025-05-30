import type {
  PutEventsCommand,
  PutEventsCommandOutput,
} from "@aws-sdk/client-eventbridge";
import type { SchedulerClient } from "../types/aws.types";
import type { Stripe } from "stripe";

export type SubscriptionEventConductorDependencies = {
  stripe: {
    customers: {
      retrieve: (
        id: string,
      ) => Promise<Stripe.Response<Stripe.Customer | Stripe.DeletedCustomer>>;
    };
    products: {
      retrieve: (id: string) => Promise<Stripe.Response<Stripe.Product>>;
    };
  };
  eventBridgeClient: {
    send: (command: PutEventsCommand) => Promise<PutEventsCommandOutput>;
  };
  uuidv4: () => string;
  eventBusName: string;
  eventBusSchedulerRoleArn: string;
  eventBusArn: string;
  schedulerClient: SchedulerClient;
};

export type StripeEventBridgeDetail = {
  id: string;
  object: string;
  api_version: string;
  created: number;
  data: {
    object: Stripe.Subscription;
    previous_attributes?: Partial<Stripe.Subscription>;
  };
  livemode: boolean;
  pending_webhooks: number;
  request: {
    id: string | null;
    idempotency_key: string | null;
  };
  type: string;
};
