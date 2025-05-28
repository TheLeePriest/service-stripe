import type {
  PutEventsCommand,
  PutEventsCommandOutput,
} from "@aws-sdk/client-eventbridge";
import type Stripe from "stripe";
import type { SchedulerClient } from "../types/aws.types";

export type SubscriptionUpdatedDependencies = {
  eventBridgeClient: {
    send: (command: PutEventsCommand) => Promise<PutEventsCommandOutput>;
  };
  eventBusName: string;
  eventBusArn: string;
  eventBusSchedulerRoleArn: string;
  schedulerClient: SchedulerClient;
};

// service-stripe/src/functions/Lambda/SubscriptionUpdated/SubscriptionUpdated.types.ts

export type SubscriptionUpdatedEvent = {
  items: {
    data: Array<{
      id: string;
      price: { product: string; id: string };
      quantity: number;
      current_period_end: number;
      metadata: Record<string, unknown>;
    }>;
  };
  customer: string;
  id: string;
  status: string;
  cancel_at_period_end: boolean;
  cancel_at?: number | null;
  previousAttributes?: Partial<Stripe.Subscription>;
};
