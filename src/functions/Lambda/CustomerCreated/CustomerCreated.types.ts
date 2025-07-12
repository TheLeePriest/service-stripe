import type { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import type { EventBridgeClient } from "@aws-sdk/client-eventbridge";
import type { StripeClient } from "../types/stripe.types";

export interface CustomerCreatedDependencies {
  stripe: StripeClient;
  eventBridgeClient: EventBridgeClient;
  eventBusName: string;
  dynamoDBClient: DynamoDBClient;
  idempotencyTableName: string;
}

export interface CustomerCreatedEvent {
  id: string;
  type: "customer.created";
  data: {
    object: {
      id: string;
      email?: string;
      name?: string;
      created: number;
    };
  };
  created: number;
} 