import type Stripe from "stripe";
import type { SubscriptionUpdatedEvent } from "../../../SubscriptionUpdated.types";
import type {
  PutEventsCommand,
  PutEventsCommandOutput,
} from "@aws-sdk/client-eventbridge";
import type { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import type { Logger } from "../../../../types/utils.types";
import type { StripeClient } from "../../../../types/stripe.types";

export type SendQuantityChangeEvents = {
  eventBridgeClient: {
    send: (command: PutEventsCommand) => Promise<PutEventsCommandOutput>;
  };
  eventBusName: string;
  subscription: SubscriptionUpdatedEvent;
  customer: Stripe.Customer;
  item: Stripe.SubscriptionItem;
  quantityDifference: number;
  stripe: StripeClient;
  logger: Logger;
  dynamoDBClient: DynamoDBClient;
  idempotencyTableName: string;
};
