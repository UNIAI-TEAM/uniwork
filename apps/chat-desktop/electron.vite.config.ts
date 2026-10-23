import { defineConfig, externalizeDepsPlugin } from "electron-vite";

// Inlined at build so dev and packaged builds share one code path; the main
// process must read these as `process.env.UNICHAT_*` member expressions.
const define = {
  "process.env.UNICHAT_ENV": JSON.stringify(process.env.UNICHAT_ENV ?? "dev"),
  "process.env.UNICHAT_APP_URL": JSON.stringify(process.env.UNICHAT_APP_URL ?? "http://localhost:3000"),
  "process.env.UNICHAT_API_URL": JSON.stringify(process.env.UNICHAT_API_URL ?? "http://localhost:8080"),
  "process.env.UNICHAT_DEPLOYMENT_ID": JSON.stringify(process.env.UNICHAT_DEPLOYMENT_ID ?? "default"),
  // electron-builder.ts signs the mac app exactly when CSC_LINK is set; only a
  // signed app can install an update itself (src/main/updater.ts).
  "process.env.UNICHAT_MAC_SIGNED": JSON.stringify(process.env.CSC_LINK ? "1" : ""),
};

export default defineConfig({
  main: {
    define,
    build: { outDir: "dist/main" },
    plugins: [externalizeDepsPlugin()],
  },
  preload: {
    // Sandboxed preload: a single CJS bundle, nothing but `electron` required.
    build: { outDir: "dist/preload", lib: { formats: ["cjs"] } },
    plugins: [externalizeDepsPlugin()],
  },
});
