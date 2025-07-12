import type { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import type { EventBridgeClient } from "@aws-sdk/client-eventbridge";
import type { StripeClient } from "../types/stripe.types";

export interface InvoicePaymentSucceededDependencies {
  stripe: StripeClient;
  eventBridgeClient: EventBridgeClient;
  eventBusName: string;
  dynamoDBClient: DynamoDBClient;
  idempotencyTableName: string;
}

export interface InvoicePaymentSucceededEvent {
  id: string;
  type: "invoice.payment_succeeded";
  data: {
    object: {
      id: string;
      customer: string;
      subscription?: string;
      status: string;
      amount_paid: number;
      currency: string;
      created: number;
    };
  };
  created: number;
} 