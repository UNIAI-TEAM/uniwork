"use client";

import { Suspense, type ReactNode } from "react";
import { useFlag } from "@uniwork/core/feature-flags";

/** Flag gate for task detail: MVP vs suite (lazy host passes the suite node). */
export function TaskDetailFlagGate(props: { mvp: ReactNode; suite: ReactNode }) {
  const parity = useFlag("tasks_work_management_parity", false);
  if (!parity) {
    return props.mvp;
  }
  return <Suspense fallback={null}>{props.suite}</Suspense>;
}
