import type {
  PutEventsCommand,
  PutEventsCommandOutput,
} from "@aws-sdk/client-eventbridge";
import type { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import type Stripe from "stripe";
import type { StripeClient } from "../types/stripe.types";
import type { Logger } from "../types/utils.types";

export type SubscriptionCreatedDependencies = {
  stripe: StripeClient;
  eventBridgeClient: {
    send: (command: PutEventsCommand) => Promise<PutEventsCommandOutput>;
  };
  dynamoDBClient: DynamoDBClient;
  eventBusName: string;
  idempotencyTableName: string;
  logger: Logger;
};

export type SubscriptionCreatedEvent = {
  items: {
    data: Array<{
      id: string;
      price: { product: string; id: string };
      quantity: number;
      current_period_end: number;
      metadata?: Stripe.Metadata;
    }>;
  };
  customer: string;
  customerEmail: string;
  customerName: string;
  id: string;
  status: Stripe.Subscription.Status;
  cancel_at_period_end: boolean;
  trial_start?: number | null;
  trial_end?: number | null;
  created: number;
  metadata?: Stripe.Metadata;
};

// Result type for the subscription created function
export type SubscriptionCreatedResult = {
  success: boolean;
  subscriptionId: string;
  customerId: string;
  isTeamSubscription: boolean;
  teamSize?: number;
  alreadyProcessed?: boolean;
};
