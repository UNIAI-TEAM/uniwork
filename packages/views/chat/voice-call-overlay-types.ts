export type VoiceCallKind = "dm" | "group";

export type VoiceCallOverlayState =
  | { status: "idle" }
  | {
      status: "incoming";
      callId: string;
      roomId: string;
      peerName: string;
      callKind: VoiceCallKind;
      callerName?: string;
    }
  | {
      status: "ringing";
      callId: string;
      roomId: string;
      peerName: string;
      outgoing: true;
      callKind: VoiceCallKind;
      withCamera?: boolean;
    }
  | {
      status: "connecting";
      callId: string;
      roomId: string;
      peerName: string;
      outgoing: boolean;
      callKind: VoiceCallKind;
      callerName?: string;
      withCamera?: boolean;
    }
  | {
      status: "active";
      callId: string;
      roomId: string;
      peerName: string;
      token: string;
      url: string;
      outgoing: boolean;
      callKind: VoiceCallKind;
      callerName?: string;
      withCamera?: boolean;
    };
