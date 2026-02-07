import type { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import type { EventBridgeClient } from "@aws-sdk/client-eventbridge";
import type { StripeClient } from "../types/stripe.types";
import type { Logger } from "../types/utils.types";

export interface SetupIntentSucceededDependencies {
  stripe: StripeClient;
  eventBridgeClient: EventBridgeClient;
  eventBusName: string;
  dynamoDBClient: DynamoDBClient;
  idempotencyTableName: string;
  logger: Logger;
}

export interface SetupIntentSucceededEvent {
  id: string;
  type: "setup_intent.succeeded";
  data: {
    object: {
      id: string;
      customer: string;
      payment_method: string;
      status: string;
      metadata?: Record<string, string>;
      created: number;
    };
  };
  created: number;
}
