"use client";

import { useAiCapabilities } from "@uniwork/core/ai";
import { Logo } from "@uniwork/ui/brand";
import { cn } from "@uniwork/ui/lib/utils";
import { ClaudeMark } from "../common/provider-icons";

/** A provider whose models give the dock a look of its own (tokens.css, `[data-ask-provider]`). */
export type AskLook = "anthropic";

const LOOKS: readonly string[] = ["anthropic"];

/** The look of a provider; null (UNI's own) for Auto, an unknown provider and one with no look yet. */
export const askLook = (provider: string | undefined): AskLook | null =>
  provider && LOOKS.includes(provider) ? (provider as AskLook) : null;

/** The look of a model key as the capabilities list it; null for Auto ("") and for a key it no longer lists. */
export function useAskModelLook(wsId: string, key: string): AskLook | null {
  const models = useAiCapabilities(wsId, wsId !== "" && key !== "").data?.models ?? [];
  return key ? askLook(models.find((m) => m.key === key)?.provider) : null;
}

/** The mark beside a model's name: the provider's for its look, UNI's for Auto and every other model. */
export function AskUniProviderMark({ look, size = 16, className }: { look: AskLook | null; size?: number; className?: string }) {
  if (look === "anthropic") return <ClaudeMark data-mark="anthropic" width={size} height={size} className={cn("shrink-0", className)} />;
  // The UNI mark is wider than tall; three quarters of the height keeps it the same visual size.
  return (
    <span data-mark="uni" className={cn("inline-flex shrink-0 items-center", className)}>
      <Logo variant="mark" size={Math.round(size * 0.75)} decorative />
    </span>
  );
}
