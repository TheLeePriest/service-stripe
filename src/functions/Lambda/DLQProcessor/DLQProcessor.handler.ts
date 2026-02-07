import { EventBridgeClient } from "@aws-sdk/client-eventbridge";
import { SQSClient } from "@aws-sdk/client-sqs";
import { dlqProcessor } from "./DLQProcessor";

const eventBusName = process.env.EVENT_BUS_NAME;
const finalDLQUrl = process.env.FINAL_DLQ_URL;
const maxRetries = parseInt(process.env.MAX_RETRIES || "5", 10);

if (!eventBusName) {
  throw new Error("Missing required environment variable: EVENT_BUS_NAME");
}

if (!finalDLQUrl) {
  throw new Error("Missing required environment variable: FINAL_DLQ_URL");
}

const eventBridgeClient = new EventBridgeClient({});
const sqsClient = new SQSClient({});

// Simple logger that matches the interface
const logger = {
  info: (message: string, context?: Record<string, unknown>) => {
    console.log(JSON.stringify({ level: "INFO", message, ...context }));
  },
  warn: (message: string, context?: Record<string, unknown>) => {
    console.warn(JSON.stringify({ level: "WARN", message, ...context }));
  },
  error: (message: string, context?: Record<string, unknown>, error?: Error) => {
    console.error(JSON.stringify({
      level: "ERROR",
      message,
      ...context,
      error: error?.message,
      stack: error?.stack,
    }));
  },
};

export const dlqProcessorHandler = dlqProcessor({
  eventBridgeClient,
  sqsClient,
  eventBusName,
  finalDLQUrl,
  maxRetries,
  logger,
});
