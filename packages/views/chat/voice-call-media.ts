/** Warm up mic capture while the browser still treats the click as a user gesture. */
export async function prepareVoiceCapture(): Promise<boolean> {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
    return false;
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    for (const track of stream.getTracks()) {
      track.stop();
    }
    return true;
  } catch {
    return false;
  }
}
