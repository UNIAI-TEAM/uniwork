import { isReadable } from "./runner-helpers";

/** A planned file and the blob the browser would send for it. */
export interface UnreadableCandidate {
  /** The planned path, root segment first; what the caller shows. */
  path: string;
  file: Blob;
}

const PROBE_CONCURRENCY = 16;

/**
 * The files the browser cannot open, found before anything is sent. Chromium
 * gives a size-0 blob for a path it cannot stat (a Windows path past MAX_PATH)
 * and reading it rejects, so only size-0 files are probed; a file with bytes
 * is never read. The paths come back in input order, exactly the files the
 * runner would end as `file_unreadable`. Rejects with an AbortError when
 * `signal` aborts.
 */
export async function findUnreadable(
  files: readonly UnreadableCandidate[],
  { signal }: { signal?: AbortSignal } = {},
): Promise<string[]> {
  const empty = files.filter((f) => f.file.size === 0);
  const verdicts: boolean[] = new Array<boolean>(empty.length).fill(true);
  let next = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
      const at = next++;
      const candidate = empty[at];
      if (!candidate) return;
      verdicts[at] = await isReadable(candidate.file);
    }
  };
  await Promise.all(Array.from({ length: Math.min(PROBE_CONCURRENCY, empty.length) }, worker));
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
  return empty.filter((_, at) => !verdicts[at]).map((f) => f.path);
}
