import type { EventBridgeClient } from "@aws-sdk/client-eventbridge";
import type { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import type { Logger } from "../types/utils.types";
import type Stripe from "stripe";

export interface SessionEventConductorDependencies {
  stripe: Stripe;
  eventBridgeClient: EventBridgeClient;
  eventBusName: string;
  dynamoDBClient: DynamoDBClient;
  idempotencyTableName: string;
  logger: Logger;
} 