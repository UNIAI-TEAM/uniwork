import { z } from "zod";

// Capability honesty (module-runtime-map.json evidence_levels / runtime_kinds).
// The engine reports what upstream CAN do; UniWork only advertises what it has
// proven. `pending` is a blocker with an owner, never a silent downgrade to
// unsupported - and never a silent upgrade to supported either.

export const evidenceLevels = ["proven", "source_read", "pending"] as const;
export const evidenceLevelSchema = z.enum(evidenceLevels);
export type EvidenceLevel = (typeof evidenceLevels)[number];

export const runtimeKinds = ["browser", "worker", "native_desktop", "internal_service", "none"] as const;
export const runtimeKindSchema = z.enum(runtimeKinds);
export type RuntimeKind = (typeof runtimeKinds)[number];

/** One capability row as the engine reports it on the wire. `supported` here
 * is the ENGINE's claim; it is not yet a product claim. */
export const capabilityEntrySchema = z.object({
  operation: z.string(),
  supported: z.boolean(),
  runtime: runtimeKindSchema,
  evidence_level: evidenceLevelSchema,
  reason: z.string().optional(),
});
export type CapabilityEntry = z.infer<typeof capabilityEntrySchema>;

/** The UniWork-facing rule: supported => proven. An entry whose engine claim
 * rests on source_read or pending evidence may not carry supported=true out of
 * the boundary, however confident the engine itself sounds. */
export const productCapabilitySchema = capabilityEntrySchema.refine(
  (entry) => !entry.supported || entry.evidence_level === "proven",
  { message: "supported capability requires evidence_level proven" },
);
export type ProductCapabilityEntry = z.infer<typeof productCapabilitySchema>;

/** Project an engine-reported row into the product row. pending proof never
 * becomes supported=true; the demotion keeps the engine's evidence_level and
 * reason so a reader sees a labelled blocker, not silent false advertising. */
export function toProductCapability(entry: CapabilityEntry): ProductCapabilityEntry {
  const supported = entry.supported && entry.evidence_level === "proven";
  if (supported === entry.supported) return entry;
  return {
    ...entry,
    supported,
    reason: entry.reason ?? "engine claims support but evidence_level is " + entry.evidence_level,
  };
}

export function toProductCapabilities(entries: readonly CapabilityEntry[]): ProductCapabilityEntry[] {
  return entries.map(toProductCapability);
}
