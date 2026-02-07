import { describe, it, expect, vi, beforeEach } from "vitest";
import { sendEvent } from "./sendEvent";
import { PutEventsCommand } from "@aws-sdk/client-eventbridge";
import { createMockLogger } from "../../../test-helpers/mocks";

vi.mock("@aws-sdk/client-eventbridge", () => ({
  PutEventsCommand: vi.fn(),
}));

describe("sendEvent", () => {
  const mockSend = vi.fn();
  const mockClient = { send: mockSend };
  const logger = createMockLogger();

  const entries = [
    {
      Source: "service.stripe",
      DetailType: "TestEvent",
      Detail: JSON.stringify({ id: "test-123" }),
      EventBusName: "test-bus",
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sends events successfully when FailedEntryCount is 0", async () => {
    mockSend.mockResolvedValue({
      FailedEntryCount: 0,
      Entries: [{ EventId: "evt-1" }],
    });

    await sendEvent(mockClient, entries, logger);

    expect(PutEventsCommand).toHaveBeenCalledWith({ Entries: entries });
    expect(mockSend).toHaveBeenCalledOnce();
    expect(logger.error).not.toHaveBeenCalled();
  });

  it("sends events successfully when FailedEntryCount is undefined", async () => {
    mockSend.mockResolvedValue({
      Entries: [{ EventId: "evt-1" }],
    });

    await sendEvent(mockClient, entries, logger);

    expect(mockSend).toHaveBeenCalledOnce();
    expect(logger.error).not.toHaveBeenCalled();
  });

  it("throws and logs when FailedEntryCount is greater than 0", async () => {
    mockSend.mockResolvedValue({
      FailedEntryCount: 1,
      Entries: [
        { ErrorCode: "InternalFailure", ErrorMessage: "Something went wrong" },
      ],
    });

    await expect(sendEvent(mockClient, entries, logger)).rejects.toThrow(
      "EventBridge PutEvents failed for 1 entries",
    );

    expect(logger.error).toHaveBeenCalledWith(
      "EventBridge PutEvents partial failure",
      expect.objectContaining({
        failedEntryCount: 1,
        failedEntries: [
          { errorCode: "InternalFailure", errorMessage: "Something went wrong" },
        ],
      }),
    );
  });

  it("handles partial failure with mixed success and failure entries", async () => {
    mockSend.mockResolvedValue({
      FailedEntryCount: 1,
      Entries: [
        { EventId: "evt-1" },
        { ErrorCode: "ThrottlingException", ErrorMessage: "Rate exceeded" },
      ],
    });

    const twoEntries = [
      { ...entries[0] },
      { ...entries[0], DetailType: "TestEvent2" },
    ];

    await expect(sendEvent(mockClient, twoEntries, logger)).rejects.toThrow(
      "EventBridge PutEvents failed for 1 entries",
    );

    expect(logger.error).toHaveBeenCalledWith(
      "EventBridge PutEvents partial failure",
      expect.objectContaining({
        failedEntries: [
          { errorCode: "ThrottlingException", errorMessage: "Rate exceeded" },
        ],
      }),
    );
  });

  it("propagates errors from the EventBridge client", async () => {
    mockSend.mockRejectedValue(new Error("Network error"));

    await expect(sendEvent(mockClient, entries, logger)).rejects.toThrow(
      "Network error",
    );
  });
});
