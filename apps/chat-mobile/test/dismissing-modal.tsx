// React Native's Modal as iOS runs it, for a test of a sheet that must not be presented while another is still
// closing (components/settings/use-step-up.ts): a Modal that was visible calls onDismiss once it has closed, which
// the preset's own mock never does. Closing finishes at once, unless a test holds it (`holdDismissals`) to see what
// waits for it, then lets it finish (`finishDismissals`). Mock the path React Native's index reads (the `Mock` prefix
// is what lets jest's hoisted factory name the import):
//
//   import { MockDismissingModal } from "@/test/dismissing-modal";
//   jest.mock("react-native/Libraries/Modal/Modal", () => ({ __esModule: true, default: MockDismissingModal }));
import { useEffect, useRef, type ReactNode } from "react";
import { View } from "react-native";

let holding = false;
const closed: (() => void)[] = [];

/** Closing sheets stay closing until finishDismissals. */
export function holdDismissals(): void {
  holding = true;
}

/** Every sheet that closed meanwhile is gone now; later ones finish at once again. */
export function finishDismissals(): void {
  holding = false;
  for (const dismissed of closed.splice(0)) dismissed();
}

interface Props {
  visible?: boolean;
  onDismiss?: () => void;
  onRequestClose?: () => void;
  testID?: string;
  children?: ReactNode;
}

export function MockDismissingModal({ visible = true, onDismiss, children }: Props) {
  const was = useRef(visible);
  const latest = useRef(onDismiss);
  latest.current = onDismiss;
  useEffect(() => {
    if (was.current && !visible) {
      const dismissed = () => latest.current?.();
      if (holding) closed.push(dismissed);
      else dismissed();
    }
    was.current = visible;
  }, [visible]);
  return visible ? <View testID="modal-host">{children}</View> : null;
}
