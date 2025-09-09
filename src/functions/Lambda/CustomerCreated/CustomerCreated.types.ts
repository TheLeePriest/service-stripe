import type { EventBridgeClient } from "@aws-sdk/client-eventbridge";
import type { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import type { Logger } from "../types/utils.types";
import type Stripe from "stripe";

export interface CustomerCreatedEvent {
  id: string;
  email: string;
  name?: string;
  created: number;
  metadata?: Record<string, string>;
}

export interface CustomerCreatedDependencies {
  eventBridgeClient: EventBridgeClient;
  eventBusName: string;
  dynamoDBClient: DynamoDBClient;
  idempotencyTableName: string;
  stripeClient: Stripe;
  logger: Logger;
} 