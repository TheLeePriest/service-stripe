import type { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import type { EventBridgeClient } from "@aws-sdk/client-eventbridge";
import type { StripeClient } from "../types/stripe.types";

export interface InvoicePaymentFailedDependencies {
  stripe: StripeClient;
  eventBridgeClient: EventBridgeClient;
  eventBusName: string;
  dynamoDBClient: DynamoDBClient;
  idempotencyTableName: string;
}

export interface InvoicePaymentFailedEvent {
  id: string;
  type: "invoice.payment_failed";
  data: {
    object: {
      id: string;
      customer: string;
      subscription?: string;
      status: string;
      amount_due: number;
      currency: string;
      created: number;
      attempt_count?: number;
    };
  };
  created: number;
} 