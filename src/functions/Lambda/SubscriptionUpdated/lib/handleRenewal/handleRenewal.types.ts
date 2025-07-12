import type { PutEventsCommand, PutEventsCommandOutput } from "@aws-sdk/client-eventbridge";
import type { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import type { SubscriptionUpdatedEvent } from "../../SubscriptionUpdated.types";
import type { Logger } from "../../../types/utils.types";
import type { StripeClient } from "../../../types/stripe.types";

export type HandleRenewal = {
  subscription: SubscriptionUpdatedEvent;
  eventBridgeClient: {
    send: (command: PutEventsCommand) => Promise<PutEventsCommandOutput>;
  };
  eventBusName: string;
  stripe: StripeClient;
  logger: Logger;
  dynamoDBClient: DynamoDBClient;
  idempotencyTableName: string;
};
