import { cleanup } from "@testing-library/react";
import type { ByteDocumentSession } from "../renderer/office/session";

/**
 * Teardown for tests that mount real DOCX tabs. The vendored reader parses on
 * setImmediate ticks that dispose() does not cancel, so a test that ends with a
 * load still running lets a tick land after jsdom is gone and throws
 * "reading 'uint8array'" as an unhandled error. Await each session's own load
 * (openEditor is memoised, so this is the load the tab started), then unmount
 * and dispose. A load that already failed or was disposed is not an error here.
 */
export async function settleDocxSessions(sessions: Map<string, ByteDocumentSession>): Promise<void> {
  await Promise.all([...sessions.values()].map((session) => session.openEditor().catch(() => undefined)));
  cleanup();
  for (const session of sessions.values()) session.dispose();
  sessions.clear();
}
