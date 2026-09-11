import { z } from "zod";
import type { ActorKind } from "./audit";

// Who did something, as every API reports it (ADR 0007). The badge is drawn
// from `kind` alone — never inferred from a name or an avatar. `ActorKind`
// itself lives in ./audit, where the audit log first needed it.

// Lenient on the wire: a kind this client predates renders as plain text.
export const ActorSchema = z.object({
  id: z.string(),
  kind: z.string(),
  display_name: z.string(),
  avatar_url: z.string().optional(),
});
export type Actor = Omit<z.infer<typeof ActorSchema>, "kind"> & { kind: ActorKind };
