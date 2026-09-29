"use client";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { useDataChannel, useLocalParticipant, useParticipants, useTrackToggle } from "@livekit/components-react";
import { Track } from "livekit-client";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  decodeSignal,
  encodeSignal,
  expireReactions,
  forgetIdentity,
  initialSignalsState,
  reduceSignal,
  REACTION_TTL_MS,
  shouldHonorMuteRequest,
  SIGNAL_TOPIC,
  type MeetingSignal,
  type SignalsState,
} from "./meeting-signals";

type SignalsApi = SignalsState & {
  localIdentity: string;
  handRaised: boolean;
  toggleHand: () => void;
  react: (value: string) => void;
  /** Host asks `identity` to mute; their client mutes itself and may unmute again. */
  requestMute: (identity: string, name: string) => void;
};

/** The part of a received LiveKit data message the signals read. */
type DataMessage = { payload: Uint8Array; from?: { identity: string } };

const Ctx = createContext<SignalsApi | null>(null);

/**
 * The same state behind a subscription, so a tile can read one participant's
 * hand and reaction without re-rendering on everyone else's.
 */
type SignalsStore = {
  get: () => SignalsState;
  set: (next: SignalsState) => void;
  subscribe: (listener: () => void) => () => void;
};

function createSignalsStore(): SignalsStore {
  let state = initialSignalsState;
  const listeners = new Set<() => void>();
  return {
    get: () => state,
    set: (next) => {
      if (next === state) return;
      state = next;
      for (const listener of listeners) listener();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

const StoreCtx = createContext<SignalsStore | null>(null);
const RequestMuteCtx = createContext<(identity: string, name: string) => void>(() => {});
const fallbackStore = createSignalsStore();

/** Client state for the room: lives only as long as the room is mounted. */
export function MeetingSignalsProvider({
  children,
  canHost = false,
  hostIdentities = [],
}: {
  children: ReactNode;
  canHost?: boolean;
  hostIdentities?: readonly string[];
}) {
  const { t } = useTranslation();
  const [state, setState] = useState<SignalsState>(initialSignalsState);
  const [store] = useState(createSignalsStore);
  const { localParticipant } = useLocalParticipant();
  const participants = useParticipants();
  const mic = useTrackToggle({ source: Track.Source.Microphone });
  const localIdentity = localParticipant.identity;
  const hostIdentitiesRef = useRef(hostIdentities);
  hostIdentitiesRef.current = hostIdentities;
  const canHostRef = useRef(canHost);
  canHostRef.current = canHost;

  const onSignal = (msg: DataMessage) => {
    const signal = decodeSignal(msg.payload);
    const from = msg.from?.identity;
    if (!signal || !from) return;
    if (signal.kind === "mute_request") {
      if (
        shouldHonorMuteRequest(from, hostIdentitiesRef.current) &&
        signal.target === localIdentity &&
        mic.enabled
      ) {
        void mic.toggle(false);
        // Muted by someone else: say so, or the viewer thinks the mic broke,
        // and put the way back on the notice itself. Top centre: the corner
        // toaster sat on the side panel, away from where the viewer looks.
        // The toaster's own live region reads it out, each time.
        toast.info(t("meetings.hostMutedYou"), {
          description: t("meetings.hostMutedYouHint"),
          position: "top-center",
          action: { label: t("meetings.micOn"), onClick: () => void mic.toggle(true) },
        });
      }
      return;
    }
    setState((s) => reduceSignal(s, from, signal, Date.now()));
  };
  const onSignalRef = useRef(onSignal);
  useLayoutEffect(() => {
    onSignalRef.current = onSignal;
  });
  // useDataChannel builds a new channel whenever its callback changes, and a
  // channel's send throws until the hook has subscribed to it. One stable
  // callback keeps one channel for the life of the room.
  const handleMessage = useCallback((msg: DataMessage) => onSignalRef.current(msg), []);
  const { send } = useDataChannel(SIGNAL_TOPIC, handleMessage);

  const publish = useCallback(
    (signal: MeetingSignal): Promise<void> | undefined => {
      if (signal.kind === "mute_request" && !canHostRef.current) return undefined;
      const sent = send(encodeSignal(signal), { reliable: true, topic: SIGNAL_TOPIC });
      sent.catch(() => {
        // A lost hand or reaction costs nobody anything; a mute the host
        // believes was sent does.
        if (signal.kind === "mute_request") toast.error(t("meetings.muteRequestFailed"));
      });
      // LiveKit does not echo our own data messages: apply locally.
      if (signal.kind !== "mute_request") setState((s) => reduceSignal(s, localIdentity, signal, Date.now()));
      return sent;
    },
    [send, localIdentity, t],
  );

  // Reactions fade out on their own; run the sweep only while some exist.
  useEffect(() => {
    if (state.reactions.length === 0) return;
    const id = window.setTimeout(() => setState((s) => expireReactions(s, Date.now())), REACTION_TTL_MS);
    return () => window.clearTimeout(id);
  }, [state.reactions]);

  // A hand belongs to someone still in the room.
  useEffect(() => {
    const present = new Set(participants.map((p) => p.identity));
    setState((s) => s.hands.filter((h) => !present.has(h)).reduce(forgetIdentity, s));
  }, [participants]);

  useEffect(() => {
    store.set(state);
  }, [store, state]);

  // Only a committed publish: a render React throws away (a suspended
  // transition) holds a channel that was never subscribed.
  const publishRef = useRef(publish);
  useLayoutEffect(() => {
    publishRef.current = publish;
  });
  const requestMute = useCallback(
    (identity: string, name: string) => {
      // The host sees the mic badge flip too, but only once their client
      // hears back; the toast says the request left, by name.
      void publishRef.current({ kind: "mute_request", target: identity })?.then(
        // Top centre, as the muted person's notice: the corner toaster sat
        // on the side panel's question box.
        () => toast.success(t("meetings.mutedParticipant", { name }), { position: "top-center" }),
        () => {},
      );
    },
    [t],
  );

  const handRaised = state.hands.includes(localIdentity);
  const api = useMemo<SignalsApi>(
    () => ({
      ...state,
      localIdentity,
      handRaised,
      toggleHand: () => publish({ kind: "hand", value: !handRaised }),
      react: (value) => publish({ kind: "reaction", value }),
      requestMute,
    }),
    [state, localIdentity, handRaised, publish, requestMute],
  );

  return (
    <StoreCtx.Provider value={store}>
      <RequestMuteCtx.Provider value={requestMute}>
        <Ctx.Provider value={api}>
          {children}
        </Ctx.Provider>
      </RequestMuteCtx.Provider>
    </StoreCtx.Provider>
  );
}

const noop: SignalsApi = {
  ...initialSignalsState,
  localIdentity: "",
  handRaised: false,
  toggleHand: () => {},
  react: () => {},
  requestMute: () => {},
};

/** Outside the provider (tests, previews) every signal is a no-op. */
export function useMeetingSignals(): SignalsApi {
  return useContext(Ctx) ?? noop;
}

/** One participant's hand and latest reaction; re-renders only when those change. */
export function useParticipantSignal(identity: string): {
  handRaised: boolean;
  reaction: SignalsState["reactions"][number] | undefined;
} {
  const store = useContext(StoreCtx) ?? fallbackStore;
  const handRaised = useSyncExternalStore(store.subscribe, () => store.get().hands.includes(identity));
  const reaction = useSyncExternalStore(store.subscribe, () =>
    store.get().reactions.filter((r) => r.identity === identity).at(-1),
  );
  return { handRaised, reaction };
}

/** Stable host-mute action, for components that must not re-render on every signal. */
export function useRequestMute(): (identity: string, name: string) => void {
  return useContext(RequestMuteCtx);
}
