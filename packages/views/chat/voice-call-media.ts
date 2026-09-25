import type {
  VoiceCallDeviceError,
  VoiceCallDeviceFailure,
  VoiceCallDeviceKind,
} from "./voice-call-overlay-types";

export type VoiceCapturePrep = { ok: true } | { ok: false; device: VoiceCallDeviceError };

/**
 * getUserMedia's rejection, sorted the way LiveKit's MediaDeviceFailure (and
 * so the meeting room's device notice) sorts it. Pure, so the pre-call path
 * does not pull the LiveKit SDK into the chat route.
 */
export function deviceFailureFromError(err: unknown): VoiceCallDeviceFailure {
  const name =
    typeof err === "object" && err !== null && "name" in err ? String((err as { name: unknown }).name) : "";
  switch (name) {
    case "NotAllowedError":
    case "PermissionDeniedError":
    case "SecurityError":
      return "denied";
    case "NotReadableError":
    case "TrackStartError":
    case "AbortError":
      return "in_use";
    case "NotFoundError":
    case "DevicesNotFoundError":
    case "OverconstrainedError":
    case "ConstraintNotSatisfiedError":
      return "missing";
    default:
      return "other";
  }
}

async function tryCapture(constraints: MediaStreamConstraints): Promise<unknown> {
  try {
    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    for (const track of stream.getTracks()) {
      track.stop();
    }
    return null;
  } catch (err) {
    return err ?? new Error("capture failed");
  }
}

function failed(kind: VoiceCallDeviceKind, err: unknown): VoiceCapturePrep {
  return { ok: false, device: { kind, failure: deviceFailureFromError(err) } };
}

function captureUnavailable(): boolean {
  return typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia;
}

/** Warm up mic capture while the browser still treats the click as a user gesture. */
export async function prepareVoiceCapture(): Promise<VoiceCapturePrep> {
  if (captureUnavailable()) return { ok: false, device: { kind: "audioinput", failure: "other" } };
  const err = await tryCapture({ audio: true });
  return err ? failed("audioinput", err) : { ok: true };
}

/**
 * Warm up mic + camera before starting a video call. When the pair fails,
 * a second mic-only try tells which of the two devices is the problem.
 */
export async function prepareVideoCapture(): Promise<VoiceCapturePrep> {
  if (captureUnavailable()) return { ok: false, device: { kind: "videoinput", failure: "other" } };
  const err = await tryCapture({ audio: true, video: true });
  if (!err) return { ok: true };
  const micErr = await tryCapture({ audio: true });
  return micErr ? failed("audioinput", micErr) : failed("videoinput", err);
}
