import type {
  PutEventsCommand,
  PutEventsCommandOutput,
} from "@aws-sdk/client-eventbridge";
import type { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import type Stripe from "stripe";
import type { StripeClient } from "../types/stripe.types";
import type { SchedulerClient } from "../types/aws.types";
import type { Logger } from "../types/utils.types";

export type SubscriptionUpdatedDependencies = {
  eventBridgeClient: {
    send: (command: PutEventsCommand) => Promise<PutEventsCommandOutput>;
  };
  eventBusName: string;
  eventBusArn: string;
  eventBusSchedulerRoleArn: string;
  schedulerClient: SchedulerClient;
  stripe: StripeClient;
  dynamoDBClient: DynamoDBClient;
  idempotencyTableName: string;
  logger: Logger;
};

export type SubscriptionUpdatedEvent = {
  items: {
    data: Array<{
      id: string;
      price: { product: string; id: string; metadata?: Record<string, string>; recurring?: { usage_type?: string } };
      quantity: number;
      current_period_end: number;
      current_period_start: number;
      metadata: Record<string, unknown>;
    }>;
  };
  createdAt: number;
  customer: string;
  id: string;
  status: string;
  cancel_at_period_end: boolean;
  cancel_at?: number | null;
  previousAttributes?: Partial<Stripe.Subscription>;
  trialStart?: number | null;
  trialEnd?: number | null;
};

export type SubscriptionState =
  | "QUANTITY_CHANGED"
  | "CANCELLING"
  | "UNCANCELLING"
  | "OTHER_UPDATE"
  | "RENEWED";
