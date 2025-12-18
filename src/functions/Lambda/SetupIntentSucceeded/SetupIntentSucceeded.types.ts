import type { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import type { EventBridgeClient } from "@aws-sdk/client-eventbridge";
import type { StripeClient } from "../types/stripe.types";

export interface SetupIntentSucceededDependencies {
  stripe: StripeClient;
  eventBridgeClient: EventBridgeClient;
  eventBusName: string;
  dynamoDBClient: DynamoDBClient;
  idempotencyTableName: string;
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
