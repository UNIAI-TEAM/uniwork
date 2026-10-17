import { useEffect, useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from "react";

/**
 * Whether the open document went to "Lưu trữ" under this frame session (ARCHIVE-01 §3): the state for
 * the render, the ref for callbacks that outlive it. It starts over when the frame moves to another document.
 */
export function useShelvedFlag(scopeId: string): {
  shelved: boolean;
  shelvedRef: MutableRefObject<boolean>;
  setShelved: Dispatch<SetStateAction<boolean>>;
} {
  const [shelved, setShelved] = useState(false);
  const shelvedRef = useRef(false);
  useEffect(() => {
    shelvedRef.current = false;
    setShelved(false);
  }, [scopeId]);
  return { shelved, shelvedRef, setShelved };
}
