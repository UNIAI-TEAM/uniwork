"use client";

import { createElement, useEffect, useState } from "react";
import { XlsxEditor, type XlsxModelHost } from "@uniwork/views/office/xlsx";

export interface XlsxRenderModelRef {
  current: XlsxModelHost | null;
  listeners: Set<(host: XlsxModelHost | null) => void>;
}

interface XlsxEditorViewProps extends Omit<Parameters<typeof XlsxEditor>[0], "rendererHost"> {
  modelRef: XlsxRenderModelRef;
}

/** The async open publishes the renderer model; session disposal releases it. */
export function XlsxEditorView({ modelRef, ...editorProps }: XlsxEditorViewProps) {
  const [host, setHost] = useState<XlsxModelHost | null>(modelRef.current);
  useEffect(() => {
    modelRef.listeners.add(setHost);
    setHost(modelRef.current);
    return () => { modelRef.listeners.delete(setHost); };
  }, [modelRef]);
  return createElement(XlsxEditor, { ...editorProps, ...(host ? { rendererHost: host } : {}) } as never);
}
