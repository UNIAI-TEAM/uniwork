/** Accept an incoming call; on unexpected failure, decline so the UI does not stay ringing. */
export async function acceptVoiceCallWithFallback(
  accept: () => Promise<boolean>,
  decline: () => void | Promise<void>,
): Promise<void> {
  try {
    await accept();
  } catch {
    await decline();
  }
}
