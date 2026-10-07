/** The engine answers this when a `pdfHandle` no longer names a document it
 * holds for this caller (closed, replaced, evicted). */
interface EngineAnswer {
  ok: boolean;
  error?: { kind?: string };
}

function isStaleHandle(answer: EngineAnswer): boolean {
  return !answer.ok && answer.error?.kind === "handle";
}

/** The renderer's side of the engine's retained PDF: the one document
 * transfer happens at open, and every page render or text read names the
 * document by handle. */
export interface PdfEngineSession {
  /** Take the handle an open answered (or none, when the open failed) as the
   * current document, closing the one it replaces. */
  adopt(pdfHandle: string | undefined): void;
  /** Run one engine call against the current document. A stale handle re-opens
   * the document once and retries; a second stale answer is returned as is. */
  run<R extends EngineAnswer>(call: (pdfHandle: string) => Promise<R>): Promise<R>;
  /** The handle of the current document, if one is held. */
  current(): string | null;
  /** Free the current document; later runs refuse. */
  close(): void;
}

export interface PdfEngineSessionPorts {
  /** Send the current bytes again with `retain` and answer the new handle;
   * rejects when the engine did not retain them. */
  reopen(): Promise<string>;
  /** Ask the engine to free a handle; best effort. */
  close(pdfHandle: string): Promise<unknown>;
}

export function createPdfEngineSession(ports: PdfEngineSessionPorts): PdfEngineSession {
  let current: string | null = null;
  let closed = false;
  /** Bumped by every adopt, so a re-open that an open or edit overtook does not
   * install a handle for the bytes it replaced. */
  let epoch = 0;
  /** One re-open in flight, shared by every render that found the handle stale
   * (a print walking N pages re-sends the document once, not N times). */
  let reopening: Promise<string> | null = null;

  const free = (pdfHandle: string | null): void => {
    if (pdfHandle) void ports.close(pdfHandle).catch(() => undefined);
  };

  const handleAfter = (stale: string | null): Promise<string> => {
    if (current && current !== stale) return Promise.resolve(current);
    if (!reopening) {
      const started = epoch;
      const pending = ports.reopen().then((pdfHandle) => {
        if (closed) {
          free(pdfHandle);
          throw new Error("pdf_surface_disposed");
        }
        if (epoch !== started && current) {
          free(pdfHandle);
          return current;
        }
        current = pdfHandle;
        return pdfHandle;
      });
      reopening = pending;
      void pending.then(() => undefined, () => undefined).finally(() => { if (reopening === pending) reopening = null; });
    }
    return reopening;
  };

  return {
    adopt(pdfHandle) {
      // An open that answered after close (a byte swap overtaken by dispose)
      // has nobody left to free it: free it now instead of holding it.
      if (closed) {
        free(pdfHandle ?? null);
        return;
      }
      epoch += 1;
      if (current !== (pdfHandle ?? null)) free(current);
      current = pdfHandle ?? null;
    },
    async run(call) {
      if (closed) throw new Error("pdf_surface_disposed");
      const first = await handleAfter(null);
      const answer = await call(first);
      if (!isStaleHandle(answer) || closed) return answer;
      return await call(await handleAfter(first));
    },
    current: () => current,
    close() {
      closed = true;
      epoch += 1;
      free(current);
      current = null;
    },
  };
}
