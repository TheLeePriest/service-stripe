import type {
  PutEventsCommand,
  PutEventsCommandOutput,
} from "@aws-sdk/client-eventbridge";
import type { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import type { SchedulerClient } from "../types/aws.types";
import type { Stripe } from "stripe";
import type { StripeClient } from "../types/stripe.types";
import type { Logger } from "../types/utils.types";

export type SubscriptionEventConductorDependencies = {
  stripe: StripeClient;
  eventBridgeClient: {
    send: (command: PutEventsCommand) => Promise<PutEventsCommandOutput>;
  };
  eventBusName: string;
  eventBusSchedulerRoleArn: string;
  eventBusArn: string;
  schedulerClient: SchedulerClient;
  dynamoDBClient: DynamoDBClient;
  idempotencyTableName: string;
  siteUrl: string;
  logger: Logger;
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
