import type {
  PutEventsCommand,
  PutEventsCommandOutput,
} from "@aws-sdk/client-eventbridge";
import type { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import type { StripeClient } from "../types/stripe.types";
import type { Logger } from "../types/utils.types";

export type SubscriptionDeletedDependencies = {
  stripe: StripeClient;
  eventBridgeClient: {
    send: (command: PutEventsCommand) => Promise<PutEventsCommandOutput>;
  };
  eventBusName: string;
  dynamoDBClient: DynamoDBClient;
  idempotencyTableName: string;
  logger: Logger;
};

export type SubscriptionDeletedEvent = {
  id: string;
  customer: string;
  status: string;
  ended_at?: number;
  canceled_at?: number;
};
