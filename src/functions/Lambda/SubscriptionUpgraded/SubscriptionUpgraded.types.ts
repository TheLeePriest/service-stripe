import type {
  PutEventsCommand,
  PutEventsCommandOutput,
} from "@aws-sdk/client-eventbridge";
import type { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import type Stripe from "stripe";
import type { StripeClient } from "../types/stripe.types";
import type { Logger } from "../types/utils.types";

export type SubscriptionUpgradedDependencies = {
  stripe: StripeClient;
  eventBridgeClient: {
    send: (command: PutEventsCommand) => Promise<PutEventsCommandOutput>;
  };
  eventBusName: string;
  logger: Logger;
};

export type SubscriptionUpgradedEvent = {
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
  id: string;
  status: Stripe.Subscription.Status;
  cancel_at_period_end: boolean;
  trial_start?: number | null;
  trial_end?: number | null;
  created: number;
  metadata?: Stripe.Metadata;
};

export type SubscriptionUpgradedResult = {
  success: boolean;
  subscriptionId: string;
  customerId: string;
  upgradeType?: string;
  originalTrialSubscriptionId?: string;
  upgradeReason?: string;
};
