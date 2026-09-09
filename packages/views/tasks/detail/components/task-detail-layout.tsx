"use client";

import type { ReactNode } from "react";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@uniwork/ui/components/ui/resizable";

const DEFAULT_LAYOUT = { content: 72, sidebar: 28 };

/** Resizable main column + properties sidebar (single tree — no dual mount). */
export function TaskDetailResizableLayout({
  main,
  sidebar,
}: {
  main: ReactNode;
  sidebar: ReactNode;
}) {
  return (
    <ResizablePanelGroup
      orientation="horizontal"
      className="min-h-0 flex-1"
      defaultLayout={DEFAULT_LAYOUT}
    >
      <ResizablePanel id="content" minSize="40%" className="min-w-0">
        {main}
      </ResizablePanel>
      <ResizableHandle withHandle />
      <ResizablePanel
        id="sidebar"
        minSize="18%"
        maxSize="42%"
        className="min-w-0 border-l border-border"
      >
        {sidebar}
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}
