// Every sheet and dialog of the app is this Modal (eslint.config.mjs forbids
// react-native's own elsewhere). An incoming call closes whatever is open
// (audit C2): the call screen is a full-screen layer, not a Modal, because
// iOS will not present a modal over one already open, so a sheet left open
// would sit over the ringing call and its Answer button. Closing goes through
// the sheet's own onRequestClose, as Android's back button does. A sheet that
// belongs to the call (the microphone primer of an answer from the
// notification) names it in keepOpenForCall and stays while that call rings.
// The app lock engaging closes whatever is open too (components/app/
// data/stores/app-lock-store.ts): a Modal is a native window of its own, above the lock
// screen the privacy guard draws, so a photo or a list left open would stay
// readable and usable over the lock. A sheet that belongs to the call that is
// on stays (the call is the one thing that shows past the lock).
// A sheet that slides in fades instead for someone who asked for less motion
// (components/ui/a11y.ts › useReduceMotion), on every sheet at once.
import { useEffect, useRef } from "react";
// The one place react-native's Modal is used: everything else renders this wrapper.
// eslint-disable-next-line @typescript-eslint/no-restricted-imports
import { Modal, type ModalProps, type NativeSyntheticEvent } from "react-native";
import { appLockState } from "@/data/stores/app-lock-store";
import { callEngine } from "@/data/calls/call-store";
import { useReduceMotion } from "./a11y";

export function CallAwareModal({ keepOpenForCall, ...props }: ModalProps & { keepOpenForCall?: string }) {
  const { visible = true, onRequestClose } = props;
  const reduceMotion = useReduceMotion();
  const close = useRef(onRequestClose);
  close.current = onRequestClose;

  useEffect(() => {
    if (!visible) return;
    // The sheets' onRequestClose handlers take no event; Android's back button passes an empty one.
    const requestClose = () => close.current?.({ nativeEvent: {} } as NativeSyntheticEvent<unknown>);
    const offCall = callEngine.store.subscribe((state, previous) => {
      const { call } = state;
      if (call.status !== "incoming" || previous.call.status === "incoming" || call.callId === keepOpenForCall) return;
      requestClose();
    });
    const offLock = appLockState.subscribe((state, previous) => {
      if (!state.engaged || previous.engaged) return;
      const { call } = callEngine.store.getState();
      if (keepOpenForCall && call.status !== "idle" && call.callId === keepOpenForCall) return;
      requestClose();
    });
    return () => {
      offCall();
      offLock();
    };
  }, [visible, keepOpenForCall]);

  return <Modal {...props} animationType={reduceMotion && props.animationType === "slide" ? "fade" : props.animationType} />;
}
