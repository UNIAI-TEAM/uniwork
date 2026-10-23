import { z } from "zod";

// Every operation the boundary routes (engine-contract.md §4). `capability` is
// the honest-probe op; the rest are job lifecycle ops.
export const engineOperations = [
  "capability",
  "open",
  "edit",
  "serialize",
  "convert",
  "export",
  "cancel",
] as const;
export const engineOperationSchema = z.enum(engineOperations);
export type EngineOperation = (typeof engineOperations)[number];
export function isEngineOperation(value: string): value is EngineOperation {
  return (engineOperations as readonly string[]).includes(value);
}

// Operations that may appear inside a job grant (§3): `cancel` is never
// granted, it is the caller-side escape hatch.
export const grantableOperations = [
  "capability",
  "open",
  "edit",
  "serialize",
  "convert",
  "export",
] as const;
export const grantableOperationSchema = z.enum(grantableOperations);
export type GrantableOperation = (typeof grantableOperations)[number];
