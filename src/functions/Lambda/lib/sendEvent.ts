import {
  PutEventsCommand,
  type PutEventsCommandOutput,
  type PutEventsRequestEntry,
} from "@aws-sdk/client-eventbridge";
import type { Logger } from "../types/logger.types";

export type EventBridgeClient = {
  send: (command: PutEventsCommand) => Promise<PutEventsCommandOutput>;
};

export async function sendEvent(
  client: EventBridgeClient,
  entries: PutEventsRequestEntry[],
  logger: Logger,
): Promise<void> {
  const response = await client.send(
    new PutEventsCommand({ Entries: entries }),
  );

  if (response.FailedEntryCount && response.FailedEntryCount > 0) {
    const failedEntries = response.Entries?.filter((e) => e.ErrorCode) || [];
    logger.error("EventBridge PutEvents partial failure", {
      failedEntryCount: response.FailedEntryCount,
      failedEntries: failedEntries.map((e) => ({
        errorCode: e.ErrorCode,
        errorMessage: e.ErrorMessage,
      })),
    });
    throw new Error(
      `EventBridge PutEvents failed for ${response.FailedEntryCount} entries`,
    );
  }
}
