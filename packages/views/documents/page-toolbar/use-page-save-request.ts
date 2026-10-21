import { useEffect, useRef, useState } from "react";
import { PAGE_SAVE_REQUEST_EVENT } from "../../editor/extensions/page-events";

/**
 * Calls `flush` when the page editor inside the returned host asks for a save
 * (Ctrl/Cmd+S, which the editor has already kept from the browser's "Save
 * page"). Pass the returned function as the `ref` of the element that wraps the
 * editor: the editor mounts lazily, so the host is tracked as state, not read
 * once at mount.
 */
export function usePageSaveRequest(flush: () => void): (host: HTMLElement | null) => void {
  const [host, setHost] = useState<HTMLElement | null>(null);
  const flushRef = useRef(flush);
  flushRef.current = flush;
  useEffect(() => {
    if (!host) return;
    const onRequest = () => flushRef.current();
    host.addEventListener(PAGE_SAVE_REQUEST_EVENT, onRequest);
    return () => host.removeEventListener(PAGE_SAVE_REQUEST_EVENT, onRequest);
  }, [host]);
  return setHost;
}
