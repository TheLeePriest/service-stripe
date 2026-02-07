import type { EventBridgeClient } from "@aws-sdk/client-eventbridge";
import type { SQSClient } from "@aws-sdk/client-sqs";

export interface DLQProcessorDependencies {
  eventBridgeClient: EventBridgeClient;
  sqsClient: SQSClient;
  eventBusName: string;
  finalDLQUrl: string;
  maxRetries: number;
  logger: Logger;
}

export interface Logger {
  info: (message: string, context?: Record<string, unknown>) => void;
  warn: (message: string, context?: Record<string, unknown>) => void;
  error: (message: string, context?: Record<string, unknown>, error?: Error) => void;
}

// The structure of an EventBridge event that failed and ended up in DLQ
export interface FailedEventBridgeEvent {
  version: string;
  id: string;
  "detail-type": string;
  source: string;
  account: string;
  time: string;
  region: string;
  resources: string[];
  detail: Record<string, unknown>;
}

// SQS message attributes for retry tracking
export interface RetryMetadata {
  retryCount: number;
  originalEventId: string;
  originalEventTime: string;
  firstFailureTime: string;
  lastRetryTime: string;
  failureReason?: string;
}

export interface ProcessingResult {
  messageId: string;
  status: "redriven" | "exhausted" | "failed";
  retryCount: number;
  error?: string;
}
