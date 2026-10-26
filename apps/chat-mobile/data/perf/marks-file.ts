// Where a measured build's startup marks go on iOS (scripts/mobile-perf.mjs ›
// ios-startup): a release build drops console.info below RCTLog's error
// threshold, so the simulator's log never shows them. The marks of this
// process, one line each, are rewritten to a file in the app's documents,
// read from the simulator's data container. Only a build made with
// UNICHAT_PERF_MARKS=1 writes it (data/boot.ts); no store build does.
import { File, Paths } from "expo-file-system";
import { createLogger } from "../logger";

export const PERF_MARKS_FILE = "unichat-perf-marks.txt";

const log = createLogger("perf");

/** Replaces the file with this process's marks so far. */
export function writePerfMarks(text: string): void {
  try {
    new File(Paths.document, PERF_MARKS_FILE).write(text);
  } catch (error) {
    log.warn("perf marks not written", { error: error instanceof Error ? error.name : typeof error });
  }
}
