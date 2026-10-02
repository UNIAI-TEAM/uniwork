import type { DesktopLeaveCoordinator } from "./leave";

interface CloseWindow {
  on(event: "close", listener: (event: { preventDefault(): void }) => void): void;
  close(): void;
}

/** Only the single-instance owner has a renderer that can answer leave.
 * Install after lock registration so a losing process can quit immediately. */
export function installPrimaryCloseGuard(window: CloseWindow, leave: DesktopLeaveCoordinator, options: {
  readonly primary: boolean;
  readonly smoke: boolean;
  readonly isApproved: () => boolean;
  readonly approve: () => void;
}): boolean {
  if (!options.primary) return false;
  window.on("close", (event) => {
    if (options.isApproved() || options.smoke) return;
    event.preventDefault();
    void leave.request("close").then((outcome) => {
      if (!outcome.proceeded) return;
      options.approve();
      window.close();
    });
  });
  return true;
}
