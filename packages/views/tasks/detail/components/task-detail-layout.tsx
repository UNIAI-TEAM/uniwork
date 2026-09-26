"use client";

import type { ReactNode } from "react";
import {
  AnimatedRightSidebarLayout,
  type AnimatedRightSidebarController,
} from "../../../layout/animated-right-sidebar";

/** Resizable main column + properties sidebar (single tree — no dual mount). */
export function TaskDetailResizableLayout({
  main,
  sidebar,
  sidebarController,
  sidebarLabel,
  sidebarDefaultSize,
}: {
  main: ReactNode;
  sidebar: ReactNode;
  sidebarController: AnimatedRightSidebarController;
  sidebarLabel: string;
  sidebarDefaultSize?: number | string;
}) {
  return (
    <AnimatedRightSidebarLayout
      controller={sidebarController}
      main={main}
      sidebar={sidebar}
      sidebarLabel={sidebarLabel}
      sidebarDefaultSize={sidebarDefaultSize}
    />
  );
}
