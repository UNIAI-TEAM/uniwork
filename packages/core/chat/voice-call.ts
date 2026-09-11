export function createVoiceCallId(): string {
  return crypto.randomUUID();
}
