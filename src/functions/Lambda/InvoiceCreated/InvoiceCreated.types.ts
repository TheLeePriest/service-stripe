import type { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import type { EventBridgeClient } from "@aws-sdk/client-eventbridge";
import type { StripeClient } from "../types/stripe.types";
import type { Logger } from "../types/utils.types";

export interface InvoiceCreatedDependencies {
  stripe: StripeClient;
  eventBridgeClient: EventBridgeClient;
  eventBusName: string;
  dynamoDBClient: DynamoDBClient;
  idempotencyTableName: string;
  logger: Logger;
}

export interface InvoiceCreatedEvent {
  id: string;
  type: "invoice.created";
  data: {
    object: {
      id: string;
      customer: string;
      status: string;
      amount_due: number;
      currency: string;
      created: number;
    };
  };
  created: number;
} 