export type ComposerMessagePriority = "important" | "urgent";

export function toggleComposerPriority(
  current: ComposerMessagePriority | null,
  next: ComposerMessagePriority,
): ComposerMessagePriority | null {
  return current === next ? null : next;
}

export function isComposerMessagePriority(value: string): value is ComposerMessagePriority {
  return value === "important" || value === "urgent";
}
