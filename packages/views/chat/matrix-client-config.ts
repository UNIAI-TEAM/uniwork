/** Suppress benign matrix-js-sdk RTC noise when room state arrives before the Room object exists. */
export function installMatrixClientNoiseFilter(): void {
  if (typeof window === "undefined") return;
  if (window.__uniworkMatrixNoiseFilterInstalled) return;
  window.__uniworkMatrixNoiseFilterInstalled = true;

  const originalError = console.error.bind(console);
  console.error = (...args: unknown[]) => {
    const combined = args
      .map((arg) => {
        if (typeof arg === "string") return arg;
        if (arg instanceof Error) return arg.message;
        return "";
      })
      .join(" ");
    if (
      combined.includes("MatrixRTCSessionManager") &&
      combined.includes("unknown room")
    ) {
      return;
    }
    originalError(...args);
  };
}

declare global {
  interface Window {
    __uniworkMatrixNoiseFilterInstalled?: boolean;
  }
}

export {};