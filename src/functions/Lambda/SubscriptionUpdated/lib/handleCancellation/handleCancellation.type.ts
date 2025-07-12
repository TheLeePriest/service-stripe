import type { SchedulerClient } from "../../../types/aws.types";
import type { SubscriptionUpdatedEvent } from "../../SubscriptionUpdated.types";
import type {
  PutEventsCommand,
  PutEventsCommandOutput,
} from "@aws-sdk/client-eventbridge";
import type { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import type { Logger } from "../../../types/utils.types";

export type HandleCancellationDependencies = {
  subscription: SubscriptionUpdatedEvent;
  eventBridgeClient: {
    send: (command: PutEventsCommand) => Promise<PutEventsCommandOutput>;
  };
  eventBusName: string;
  logger: Logger;
  dynamoDBClient: DynamoDBClient;
  idempotencyTableName: string;
};
