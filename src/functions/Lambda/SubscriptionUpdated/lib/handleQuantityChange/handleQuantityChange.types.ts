import type {
  PutEventsCommand,
  PutEventsCommandOutput,
} from "@aws-sdk/client-eventbridge";
import type { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import type { StripeClient } from "../../../types/stripe.types";
import type Stripe from "stripe";
import type { SubscriptionUpdatedEvent } from "../../SubscriptionUpdated.types";
import type { Logger } from "../../../types/utils.types";

export type HandleQuantityChange = {
  subscriptionId: string;
  eventBridgeClient: {
    send: (command: PutEventsCommand) => Promise<PutEventsCommandOutput>;
  };
  eventBusName: string;
  stripe: StripeClient;
  previousAttributes: Partial<Stripe.Subscription> | undefined;
  subscription: SubscriptionUpdatedEvent;
  logger: Logger;
  dynamoDBClient: DynamoDBClient;
  idempotencyTableName: string;
};
