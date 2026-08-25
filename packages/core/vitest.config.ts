import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  // jsdom rather than node: the feature-flag and i18n providers are React and
  // have to mount. `setup.ts` unmounts between cases — without it Testing
  // Library keeps every previous render in the same document and any
  // `getByTestId` finds several matches.
  test: { environment: "jsdom", setupFiles: ["./test/setup.ts"] },
});
