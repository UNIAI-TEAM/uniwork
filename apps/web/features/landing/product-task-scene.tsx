"use client";
import { ProductTaskBoard } from "./product-task-board";
import { DEMO_TASKS } from "./product-task-data";

export function ProductTaskScene({ step }: { step: number }) {
  const tasks = DEMO_TASKS.map(task => task.key === "design" ? { ...task, person: step >= 3 ? "HA" : task.person, state: step === 6 ? "done" as const : task.state } : task);
  return <ProductTaskBoard tasks={tasks} step={step} />;
}
