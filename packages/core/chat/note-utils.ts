export const NOTE_BODY_MAX_LENGTH = 2000;

export function canSubmitNote(body: string): boolean {
  const trimmed = body.trim();
  return trimmed.length > 0 && trimmed.length <= NOTE_BODY_MAX_LENGTH;
}
