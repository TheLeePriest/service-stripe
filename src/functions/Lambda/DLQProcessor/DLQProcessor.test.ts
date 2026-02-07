import { describe, it, expect, vi, beforeEach } from "vitest";
import { dlqProcessor } from "./DLQProcessor";
import type { SQSEvent, SQSRecord } from "aws-lambda";

// Mock clients
const mockEventBridgeSend = vi.fn();
const mockSQSSend = vi.fn();

const mockEventBridgeClient = {
  send: mockEventBridgeSend,
};

const mockSQSClient = {
  send: mockSQSSend,
};

// Mock logger
const mockLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

const createHandler = (maxRetries = 5) =>
  dlqProcessor({
    eventBridgeClient: mockEventBridgeClient as any,
    sqsClient: mockSQSClient as any,
    eventBusName: "test-event-bus",
    finalDLQUrl: "https://sqs.us-east-1.amazonaws.com/123456789012/final-dlq",
    maxRetries,
    logger: mockLogger,
  });

const createFailedEventBridgeEvent = (detailType: string, detail: Record<string, unknown> = {}) => ({
  version: "0",
  id: "original-event-id-123",
  "detail-type": detailType,
  source: "service.license",
  account: "123456789012",
  time: "2024-01-15T10:30:00Z",
  region: "us-east-1",
  resources: [],
  detail,
});

const createSQSRecord = (
  body: string,
  messageAttributes: Record<string, { stringValue?: string; dataType: string }> = {}
): SQSRecord => ({
  messageId: "msg-123",
  receiptHandle: "receipt-handle-123",
  body,
  attributes: {
    ApproximateReceiveCount: "1",
    SentTimestamp: "1705312200000",
    SenderId: "SENDER123",
    ApproximateFirstReceiveTimestamp: "1705312200000",
  },
  messageAttributes,
  md5OfBody: "md5hash",
  eventSource: "aws:sqs",
  eventSourceARN: "arn:aws:sqs:us-east-1:123456789012:test-dlq",
  awsRegion: "us-east-1",
});

const createSQSEvent = (records: SQSRecord[]): SQSEvent => ({
  Records: records,
});

describe("DLQProcessor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEventBridgeSend.mockResolvedValue({});
    mockSQSSend.mockResolvedValue({});
  });

  describe("Event re-emission", () => {
    it("should re-emit failed events to EventBridge", async () => {
      const handler = createHandler();
      const failedEvent = createFailedEventBridgeEvent("LicenseCreated", {
        licenseKey: "key-123",
        status: "ACTIVE",
      });

      const sqsEvent = createSQSEvent([createSQSRecord(JSON.stringify(failedEvent))]);

      const result = await handler(sqsEvent);

      expect(result.batchItemFailures).toHaveLength(0);
      expect(mockEventBridgeSend).toHaveBeenCalledTimes(1);

      const putEventsCommand = mockEventBridgeSend.mock.calls[0][0];
      expect(putEventsCommand.input.Entries[0].EventBusName).toBe("test-event-bus");
      expect(putEventsCommand.input.Entries[0].DetailType).toBe("LicenseCreated");
      expect(putEventsCommand.input.Entries[0].Source).toBe("service.license");

      // Verify retry metadata is added
      const detail = JSON.parse(putEventsCommand.input.Entries[0].Detail);
      expect(detail._retryMetadata).toBeDefined();
      expect(detail._retryMetadata.retryCount).toBe(1);
      expect(detail._retryMetadata.originalEventId).toBe("original-event-id-123");
    });

    it("should increment retry count from message attributes", async () => {
      const handler = createHandler();
      const failedEvent = createFailedEventBridgeEvent("LicenseAssigned", {
        licenseKey: "key-123",
      });

      const sqsEvent = createSQSEvent([
        createSQSRecord(JSON.stringify(failedEvent), {
          retryCount: { stringValue: "2", dataType: "Number" },
          originalEventId: { stringValue: "orig-123", dataType: "String" },
          originalEventTime: { stringValue: "2024-01-15T09:00:00Z", dataType: "String" },
          firstFailureTime: { stringValue: "2024-01-15T09:30:00Z", dataType: "String" },
        }),
      ]);

      await handler(sqsEvent);

      const putEventsCommand = mockEventBridgeSend.mock.calls[0][0];
      const detail = JSON.parse(putEventsCommand.input.Entries[0].Detail);
      expect(detail._retryMetadata.retryCount).toBe(3);
      expect(detail._retryMetadata.originalEventId).toBe("orig-123");
    });
  });

  describe("Max retries exhaustion", () => {
    it("should send to Final DLQ when max retries exceeded", async () => {
      const handler = createHandler(5);
      const failedEvent = createFailedEventBridgeEvent("LicenseCreated", {
        licenseKey: "key-123",
      });

      const sqsEvent = createSQSEvent([
        createSQSRecord(JSON.stringify(failedEvent), {
          retryCount: { stringValue: "5", dataType: "Number" },
          originalEventId: { stringValue: "orig-123", dataType: "String" },
          firstFailureTime: { stringValue: "2024-01-15T09:30:00Z", dataType: "String" },
        }),
      ]);

      const result = await handler(sqsEvent);

      // Should not re-emit to EventBridge
      expect(mockEventBridgeSend).not.toHaveBeenCalled();

      // Should send to Final DLQ
      expect(mockSQSSend).toHaveBeenCalledTimes(1);
      const sendMessageCommand = mockSQSSend.mock.calls[0][0];
      expect(sendMessageCommand.input.QueueUrl).toContain("final-dlq");

      // Verify the message body contains original event and metadata
      const messageBody = JSON.parse(sendMessageCommand.input.MessageBody);
      expect(messageBody.originalEvent).toBeDefined();
      expect(messageBody.retryMetadata.retryCount).toBe(5);
      expect(messageBody.retryMetadata.exhaustedAt).toBeDefined();

      // Verify message attributes
      expect(sendMessageCommand.input.MessageAttributes.eventType.StringValue).toBe("LicenseCreated");
      expect(sendMessageCommand.input.MessageAttributes.retryCount.StringValue).toBe("5");

      // Should return success (message deleted from DLQ)
      expect(result.batchItemFailures).toHaveLength(0);

      expect(mockLogger.warn).toHaveBeenCalledWith(
        "Event exhausted max retries, sending to final DLQ",
        expect.any(Object)
      );
    });

    it("should handle max retries boundary correctly", async () => {
      const handler = createHandler(3);
      const failedEvent = createFailedEventBridgeEvent("TeamCreated", {
        teamId: "team-123",
      });

      // Retry count 2 (under max) should re-emit
      const sqsEvent1 = createSQSEvent([
        createSQSRecord(JSON.stringify(failedEvent), {
          retryCount: { stringValue: "2", dataType: "Number" },
        }),
      ]);

      await handler(sqsEvent1);
      expect(mockEventBridgeSend).toHaveBeenCalledTimes(1);
      expect(mockSQSSend).not.toHaveBeenCalled();

      vi.clearAllMocks();

      // Retry count 3 (at max) should go to Final DLQ
      const sqsEvent2 = createSQSEvent([
        createSQSRecord(JSON.stringify(failedEvent), {
          retryCount: { stringValue: "3", dataType: "Number" },
        }),
      ]);

      await handler(sqsEvent2);
      expect(mockEventBridgeSend).not.toHaveBeenCalled();
      expect(mockSQSSend).toHaveBeenCalledTimes(1);
    });
  });

  describe("Batch processing", () => {
    it("should process multiple messages in a batch", async () => {
      const handler = createHandler();
      const event1 = createFailedEventBridgeEvent("LicenseCreated", { licenseKey: "key-1" });
      const event2 = createFailedEventBridgeEvent("LicenseAssigned", { licenseKey: "key-2" });
      const event3 = createFailedEventBridgeEvent("TeamCreated", { teamId: "team-1" });

      const sqsEvent = createSQSEvent([
        { ...createSQSRecord(JSON.stringify(event1)), messageId: "msg-1" },
        { ...createSQSRecord(JSON.stringify(event2)), messageId: "msg-2" },
        { ...createSQSRecord(JSON.stringify(event3)), messageId: "msg-3" },
      ]);

      const result = await handler(sqsEvent);

      expect(mockEventBridgeSend).toHaveBeenCalledTimes(3);
      expect(result.batchItemFailures).toHaveLength(0);

      expect(mockLogger.info).toHaveBeenCalledWith(
        "DLQ batch processing complete",
        expect.objectContaining({
          total: 3,
          redriven: 3,
          exhausted: 0,
          failed: 0,
        })
      );
    });

    it("should report partial batch failures", async () => {
      const handler = createHandler();
      const event1 = createFailedEventBridgeEvent("LicenseCreated", { licenseKey: "key-1" });
      const event2 = createFailedEventBridgeEvent("LicenseAssigned", { licenseKey: "key-2" });

      // First event succeeds, second fails
      mockEventBridgeSend
        .mockResolvedValueOnce({})
        .mockRejectedValueOnce(new Error("EventBridge error"));

      const sqsEvent = createSQSEvent([
        { ...createSQSRecord(JSON.stringify(event1)), messageId: "msg-1" },
        { ...createSQSRecord(JSON.stringify(event2)), messageId: "msg-2" },
      ]);

      const result = await handler(sqsEvent);

      // Only the failed message should be in batchItemFailures
      expect(result.batchItemFailures).toHaveLength(1);
      expect(result.batchItemFailures[0].itemIdentifier).toBe("msg-2");

      expect(mockLogger.info).toHaveBeenCalledWith(
        "DLQ batch processing complete",
        expect.objectContaining({
          total: 2,
          redriven: 1,
          failed: 1,
        })
      );
    });
  });

  describe("Error handling", () => {
    it("should handle malformed message body gracefully", async () => {
      const handler = createHandler();
      const sqsEvent = createSQSEvent([
        createSQSRecord("not valid json"),
      ]);

      const result = await handler(sqsEvent);

      expect(result.batchItemFailures).toHaveLength(1);
      expect(mockLogger.error).toHaveBeenCalledWith(
        "Failed to process DLQ message",
        expect.any(Object),
        expect.any(Error)
      );
    });

    it("should handle EventBridge send failure", async () => {
      const handler = createHandler();
      mockEventBridgeSend.mockRejectedValueOnce(new Error("EventBridge unavailable"));

      const failedEvent = createFailedEventBridgeEvent("LicenseCreated", {
        licenseKey: "key-123",
      });

      const sqsEvent = createSQSEvent([createSQSRecord(JSON.stringify(failedEvent))]);

      const result = await handler(sqsEvent);

      expect(result.batchItemFailures).toHaveLength(1);
      expect(result.batchItemFailures[0].itemIdentifier).toBe("msg-123");
    });

    it("should handle Final DLQ send failure", async () => {
      const handler = createHandler(1);
      mockSQSSend.mockRejectedValueOnce(new Error("SQS unavailable"));

      const failedEvent = createFailedEventBridgeEvent("LicenseCreated", {
        licenseKey: "key-123",
      });

      const sqsEvent = createSQSEvent([
        createSQSRecord(JSON.stringify(failedEvent), {
          retryCount: { stringValue: "1", dataType: "Number" },
        }),
      ]);

      const result = await handler(sqsEvent);

      // Should fail because we couldn't send to Final DLQ
      expect(result.batchItemFailures).toHaveLength(1);
    });
  });

  describe("Logging", () => {
    it("should log processing details for each message", async () => {
      const handler = createHandler();
      const failedEvent = createFailedEventBridgeEvent("LicenseCreated", {
        licenseKey: "key-123",
      });

      const sqsEvent = createSQSEvent([createSQSRecord(JSON.stringify(failedEvent))]);

      await handler(sqsEvent);

      expect(mockLogger.info).toHaveBeenCalledWith(
        "Processing DLQ batch",
        expect.objectContaining({ messageCount: 1 })
      );

      expect(mockLogger.info).toHaveBeenCalledWith(
        "Processing failed event",
        expect.objectContaining({
          eventType: "LicenseCreated",
          originalEventId: "original-event-id-123",
        })
      );

      expect(mockLogger.info).toHaveBeenCalledWith(
        "Event redriven successfully",
        expect.objectContaining({ newRetryCount: 1 })
      );
    });
  });
});
