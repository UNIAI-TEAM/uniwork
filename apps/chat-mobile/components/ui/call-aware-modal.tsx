// Every sheet and dialog of the app is this Modal (eslint.config.mjs forbids
// react-native's own elsewhere). An incoming call closes whatever is open
// (audit C2): the call screen is a full-screen layer, not a Modal, because
// iOS will not present a modal over one already open, so a sheet left open
// would sit over the ringing call and its Answer button. Closing goes through
// the sheet's own onRequestClose, as Android's back button does. A sheet that
// belongs to the call (the microphone primer of an answer from the
// notification) names it in keepOpenForCall and stays while that call rings.
import { useEffect, useRef } from "react";
// The one place react-native's Modal is used: everything else renders this wrapper.
// eslint-disable-next-line @typescript-eslint/no-restricted-imports
import { Modal, type ModalProps, type NativeSyntheticEvent } from "react-native";
import { callEngine } from "@/data/calls/call-store";

export function CallAwareModal({ keepOpenForCall, ...props }: ModalProps & { keepOpenForCall?: string }) {
  const { visible = true, onRequestClose } = props;
  const close = useRef(onRequestClose);
  close.current = onRequestClose;

  useEffect(() => {
    if (!visible) return;
    return callEngine.store.subscribe((state, previous) => {
      const { call } = state;
      if (call.status !== "incoming" || previous.call.status === "incoming" || call.callId === keepOpenForCall) return;
      // The sheets' onRequestClose handlers take no event; Android's back button passes an empty one.
      close.current?.({ nativeEvent: {} } as NativeSyntheticEvent<unknown>);
    });
  }, [visible, keepOpenForCall]);

  return <Modal {...props} />;
}
