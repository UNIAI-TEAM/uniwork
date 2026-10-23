"use client";
import { ProductTaskBoard } from "./product-task-board";
import { DEMO_TASKS } from "./product-task-data";

export function ProductTaskScene({ step, summary = false }: { step: number; summary?: boolean }) {
  const tasks = DEMO_TASKS.map(task => task.key === "design" ? { ...task, person: step >= 3 ? "HA" : task.person, state: step === 6 ? "done" as const : task.state } : task);
  // The phone's non-interactive closing illustration shows complete sample rows.
  // The interactive demo and its full storyboard always retain all ten tasks.
  return <ProductTaskBoard tasks={summary ? tasks.filter(task => ["brief", "design", "launch"].includes(task.key)) : tasks} step={summary ? undefined : step} hideEmptyStatuses={summary} />;
}
