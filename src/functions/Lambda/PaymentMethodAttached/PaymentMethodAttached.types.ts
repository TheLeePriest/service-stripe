import type { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import type { EventBridgeClient } from "@aws-sdk/client-eventbridge";
import type { StripeClient } from "../types/stripe.types";

export interface PaymentMethodAttachedDependencies {
  stripe: StripeClient;
  eventBridgeClient: EventBridgeClient;
  eventBusName: string;
  dynamoDBClient: DynamoDBClient;
  idempotencyTableName: string;
}

export interface PaymentMethodAttachedEvent {
  id: string;
  type: "payment_method.attached";
  data: {
    object: {
      id: string;
      customer: string;
      type: string;
      card?: {
        brand: string;
        last4: string;
        exp_month: number;
        exp_year: number;
      };
      created: number;
    };
  };
  created: number;
} 