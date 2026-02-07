import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  ensureIdempotency,
  batchCheckIdempotency,
  generateEventId,
} from "./idempotency";
import { createMockLogger } from "../../../test-helpers/mocks";

describe("idempotency", () => {
  const mockSend = vi.fn();
  const mockDynamoDBClient = { send: mockSend } as any;
  const logger = createMockLogger();
  const tableName = "test-idempotency-table";

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-01-15T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("generateEventId", () => {
    it("generates an ID with event type, stripe ID, and timestamp", () => {
      const result = generateEventId("subscription-created", "sub_123", 1700000000);
      expect(result).toBe("subscription-created-sub_123-1700000000");
    });

    it("uses current time when no timestamp is provided", () => {
      const now = Math.floor(Date.now() / 1000);
      const result = generateEventId("invoice-created", "inv_456");
      expect(result).toBe(`invoice-created-inv_456-${now}`);
    });
  });

  describe("ensureIdempotency", () => {
    const config = { dynamoDBClient: mockDynamoDBClient, tableName, logger };

    it("returns isDuplicate: false for a new event", async () => {
      mockSend.mockResolvedValue({});

      const result = await ensureIdempotency(config, "test-event-1", {
        customerId: "cus_123",
      });

      expect(result).toEqual({ isDuplicate: false });
      expect(logger.info).toHaveBeenCalledWith("Event marked as processed", {
        eventId: "test-event-1",
      });

      // Verify the PutItem was called with correct parameters
      const command = mockSend.mock.calls[0][0];
      expect(command.input).toEqual(
        expect.objectContaining({
          TableName: tableName,
          ConditionExpression: "attribute_not_exists(PK)",
          Item: expect.objectContaining({
            PK: { S: "test-event-1" },
            data: { S: JSON.stringify({ customerId: "cus_123" }) },
          }),
        }),
      );
    });

    it("returns isDuplicate: true when event was already processed", async () => {
      const error = new Error("Condition not met");
      error.name = "ConditionalCheckFailedException";
      mockSend.mockRejectedValue(error);

      const result = await ensureIdempotency(config, "test-event-1");

      expect(result).toEqual({ isDuplicate: true });
      expect(logger.info).toHaveBeenCalledWith(
        "Event already processed (race condition)",
        { eventId: "test-event-1" },
      );
    });

    it("rethrows unexpected DynamoDB errors", async () => {
      const error = new Error("Service unavailable");
      error.name = "ServiceUnavailableException";
      mockSend.mockRejectedValue(error);

      await expect(
        ensureIdempotency(config, "test-event-1"),
      ).rejects.toThrow("Service unavailable");

      expect(logger.error).toHaveBeenCalledWith("Error checking idempotency", {
        eventId: "test-event-1",
        error: "Service unavailable",
      });
    });

    it("sets TTL correctly with default 24 hours", async () => {
      mockSend.mockResolvedValue({});

      await ensureIdempotency(config, "test-event-1");

      const command = mockSend.mock.calls[0][0];
      const now = Math.floor(Date.now() / 1000);
      expect(command.input.Item.ttl).toEqual({ N: (now + 86400).toString() });
    });

    it("sets custom TTL when provided", async () => {
      mockSend.mockResolvedValue({});

      await ensureIdempotency(config, "test-event-1", undefined, 3600);

      const command = mockSend.mock.calls[0][0];
      const now = Math.floor(Date.now() / 1000);
      expect(command.input.Item.ttl).toEqual({ N: (now + 3600).toString() });
    });

    it("omits data attribute when eventData is not provided", async () => {
      mockSend.mockResolvedValue({});

      await ensureIdempotency(config, "test-event-1");

      const command = mockSend.mock.calls[0][0];
      expect(command.input.Item.data).toBeUndefined();
    });
  });

  describe("batchCheckIdempotency", () => {
    const config = { dynamoDBClient: mockDynamoDBClient, tableName, logger };

    it("returns empty map for empty input", async () => {
      const result = await batchCheckIdempotency(config, []);
      expect(result.size).toBe(0);
      expect(mockSend).not.toHaveBeenCalled();
    });

    it("identifies existing and new events", async () => {
      mockSend.mockResolvedValue({
        Responses: {
          [tableName]: [
            {
              PK: { S: "event-1" },
              data: { S: JSON.stringify({ foo: "bar" }) },
              processedAt: { N: "1700000000" },
            },
          ],
        },
      });

      const result = await batchCheckIdempotency(config, [
        "event-1",
        "event-2",
      ]);

      expect(result.get("event-1")).toEqual({
        isDuplicate: true,
        existingData: { foo: "bar" },
      });
      expect(result.get("event-2")).toEqual({ isDuplicate: false });
    });

    it("handles items without data attribute", async () => {
      mockSend.mockResolvedValue({
        Responses: {
          [tableName]: [
            {
              PK: { S: "event-1" },
              processedAt: { N: "1700000000" },
            },
          ],
        },
      });

      const result = await batchCheckIdempotency(config, ["event-1"]);

      expect(result.get("event-1")).toEqual({
        isDuplicate: true,
        existingData: undefined,
      });
    });

    it("rethrows DynamoDB errors", async () => {
      mockSend.mockRejectedValue(new Error("Throughput exceeded"));

      await expect(
        batchCheckIdempotency(config, ["event-1"]),
      ).rejects.toThrow("Throughput exceeded");

      expect(logger.error).toHaveBeenCalledWith(
        "Error in batch idempotency check",
        expect.objectContaining({
          batchSize: 1,
          error: "Throughput exceeded",
        }),
      );
    });

    it("handles empty Responses from DynamoDB", async () => {
      mockSend.mockResolvedValue({
        Responses: {
          [tableName]: [],
        },
      });

      const result = await batchCheckIdempotency(config, ["event-1"]);
      expect(result.get("event-1")).toEqual({ isDuplicate: false });
    });
  });
});
