import type { SQSEvent, SQSBatchResponse, SQSBatchItemFailure } from "aws-lambda";
import { PutEventsCommand } from "@aws-sdk/client-eventbridge";
import { SendMessageCommand } from "@aws-sdk/client-sqs";
import type {
  DLQProcessorDependencies,
  FailedEventBridgeEvent,
  RetryMetadata,
  ProcessingResult,
} from "./DLQProcessor.types";

export const dlqProcessor = (deps: DLQProcessorDependencies) => {
  const { eventBridgeClient, sqsClient, eventBusName, finalDLQUrl, maxRetries, logger } = deps;

  return async (event: SQSEvent): Promise<SQSBatchResponse> => {
    const batchItemFailures: SQSBatchItemFailure[] = [];
    const results: ProcessingResult[] = [];

    logger.info("Processing DLQ batch", {
      messageCount: event.Records.length,
      maxRetries,
    });

    for (const record of event.Records) {
      const result = await processMessage(record.messageId, record.body, record.messageAttributes);
      results.push(result);

      // If processing failed (not exhausted, but actual error), mark for retry
      if (result.status === "failed") {
        batchItemFailures.push({ itemIdentifier: record.messageId });
      }
    }

    // Log summary
    const redriven = results.filter(r => r.status === "redriven").length;
    const exhausted = results.filter(r => r.status === "exhausted").length;
    const failed = results.filter(r => r.status === "failed").length;

    logger.info("DLQ batch processing complete", {
      total: results.length,
      redriven,
      exhausted,
      failed,
    });

    return { batchItemFailures };
  };

  async function processMessage(
    messageId: string,
    body: string,
    messageAttributes: Record<string, { stringValue?: string; dataType: string }>
  ): Promise<ProcessingResult> {
    try {
      // Parse the failed EventBridge event from the message body
      const failedEvent: FailedEventBridgeEvent = JSON.parse(body);

      // Extract retry metadata from message attributes (if present)
      const retryCount = messageAttributes.retryCount?.stringValue
        ? parseInt(messageAttributes.retryCount.stringValue, 10)
        : 0;

      const originalEventId = messageAttributes.originalEventId?.stringValue || failedEvent.id;
      const originalEventTime = messageAttributes.originalEventTime?.stringValue || failedEvent.time;
      const firstFailureTime = messageAttributes.firstFailureTime?.stringValue || new Date().toISOString();

      logger.info("Processing failed event", {
        messageId,
        eventType: failedEvent["detail-type"],
        source: failedEvent.source,
        originalEventId,
        retryCount,
        maxRetries,
      });

      // Check if we've exceeded max retries
      if (retryCount >= maxRetries) {
        logger.warn("Event exhausted max retries, sending to final DLQ", {
          messageId,
          eventType: failedEvent["detail-type"],
          originalEventId,
          retryCount,
          firstFailureTime,
        });

        // Send to Final DLQ with full context for investigation
        await sqsClient.send(
          new SendMessageCommand({
            QueueUrl: finalDLQUrl,
            MessageBody: JSON.stringify({
              originalEvent: failedEvent,
              retryMetadata: {
                retryCount,
                originalEventId,
                originalEventTime,
                firstFailureTime,
                exhaustedAt: new Date().toISOString(),
              },
            }),
            MessageAttributes: {
              eventType: {
                DataType: "String",
                StringValue: failedEvent["detail-type"],
              },
              source: {
                DataType: "String",
                StringValue: failedEvent.source,
              },
              retryCount: {
                DataType: "Number",
                StringValue: String(retryCount),
              },
            },
          })
        );

        logger.info("Event sent to Final DLQ", {
          messageId,
          eventType: failedEvent["detail-type"],
          originalEventId,
        });

        return {
          messageId,
          status: "exhausted",
          retryCount,
        };
      }

      // Re-emit the event to EventBridge with retry metadata in the detail
      const newRetryCount = retryCount + 1;

      await eventBridgeClient.send(
        new PutEventsCommand({
          Entries: [
            {
              EventBusName: eventBusName,
              Source: failedEvent.source,
              DetailType: failedEvent["detail-type"],
              Detail: JSON.stringify({
                ...failedEvent.detail,
                // Add retry metadata to the event detail for tracking
                _retryMetadata: {
                  retryCount: newRetryCount,
                  originalEventId,
                  originalEventTime,
                  firstFailureTime,
                  lastRetryTime: new Date().toISOString(),
                } as RetryMetadata,
              }),
              // Preserve original event time for ordering
              Time: new Date(failedEvent.time),
            },
          ],
        })
      );

      logger.info("Event redriven successfully", {
        messageId,
        eventType: failedEvent["detail-type"],
        originalEventId,
        newRetryCount,
      });

      return {
        messageId,
        status: "redriven",
        retryCount: newRetryCount,
      };
    } catch (error) {
      logger.error(
        "Failed to process DLQ message",
        { messageId },
        error instanceof Error ? error : new Error(String(error))
      );

      return {
        messageId,
        status: "failed",
        retryCount: 0,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
};
