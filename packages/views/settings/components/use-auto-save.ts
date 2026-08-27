"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { SettingsSaveStatus } from "./settings-layout";

interface UseAutoSaveOptions<T> {
  value: T;
  savedValue: T;
  onSave: (value: T) => Promise<void>;
  onSuccess?: (value: T) => void;
  onError?: (error: unknown) => void;
  enabled?: boolean;
  delay?: number;
  isEqual: (left: T, right: T) => boolean;
}

interface AutoSaveResult<T> {
  status: SettingsSaveStatus;
  flush: () => void;
  saveNow: (value: T) => void;
}

/** Debounces text-heavy settings while serializing in-flight saves. */
export function useAutoSave<T>({
  value,
  savedValue,
  onSave,
  onSuccess,
  onError,
  enabled = true,
  delay = 650,
  isEqual,
}: UseAutoSaveOptions<T>): AutoSaveResult<T> {
  const [status, setStatus] = useState<SettingsSaveStatus>("idle");
  const mountedRef = useRef(true);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savingRef = useRef(false);
  const queuedRef = useRef<T | null>(null);
  const latestValueRef = useRef(value);
  const persistedRef = useRef(savedValue);
  const observedSavedRef = useRef(savedValue);

  latestValueRef.current = value;

  if (!isEqual(savedValue, observedSavedRef.current)) {
    observedSavedRef.current = savedValue;
    persistedRef.current = savedValue;
  }

  const runSave = useCallback(
    async (next: T) => {
      if (!enabled || isEqual(next, persistedRef.current)) {
        return;
      }
      if (savingRef.current) {
        queuedRef.current = next;
        return;
      }

      savingRef.current = true;
      let succeeded = false;
      if (mountedRef.current) setStatus("saving");
      try {
        await onSave(next);
        persistedRef.current = next;
        succeeded = true;
      } catch (error) {
        if (mountedRef.current) setStatus("error");
        onError?.(error);
      } finally {
        savingRef.current = false;
        const queued = queuedRef.current;
        queuedRef.current = null;
        if (queued && !isEqual(queued, persistedRef.current)) {
          void runSave(queued);
        } else if (succeeded && mountedRef.current) {
          setStatus("saved");
          onSuccess?.(next);
        }
      }
    },
    [enabled, isEqual, onError, onSave, onSuccess],
  );

  const saveNow = useCallback(
    (next: T) => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      void runSave(next);
    },
    [runSave],
  );

  const flush = useCallback(() => {
    saveNow(latestValueRef.current);
  }, [saveNow]);

  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);

    if (!enabled || isEqual(value, persistedRef.current)) {
      timerRef.current = null;
      if (!enabled) setStatus("idle");
      return;
    }

    setStatus("saving");
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      void runSave(latestValueRef.current);
    }, delay);

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [delay, enabled, isEqual, runSave, value]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  return { status, flush, saveNow };
}
