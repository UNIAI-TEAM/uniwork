// Route files (app/**) compose a screen: its queries, its state and the wiring
// of parts that live in components/ (measured by jest) or lib/ (measured here).
// jest.config.js measures app/ only as one group (coverage-floor.json › routes,
// rendered through the real router by test/routes/), so a component or hook
// defined in a route file would escape the per-file floors. This test holds that: a
// route file defines its default export and nothing else, except the names
// below, each with the reason it has to be there. The list only shrinks.
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const appRoot = path.resolve(__dirname, "..");

/** The workspace-gated screen body: the default export resolves the workspace (useChatWorkspace) and renders it, so its hooks always have one. */
const SCREEN_BODY = "screen body behind the workspace gate";

const ALLOWED: Record<string, Record<string, string>> = {
  "app/+native-intent.ts": { redirectSystemPath: "expo-router's native-intent API" },
  "app/_layout.tsx": {
    ErrorBoundary: "expo-router's error boundary export",
    RootLayout: "the root layout, exported wrapped by Sentry",
    AuthInitializer: "composition root: boot order of auth, push and calls",
    useSplashUntilReady: "composition root: the splash held until auth is read",
    openUrl: "composition root: a notification tap routed once",
  },
  "app/(app)/[org]/[ws]/_layout.tsx": {
    ErrorBoundary: "expo-router's error boundary export",
    RealtimeSubscriptions: "the workspace's realtime hooks, mounted once the workspace id is known",
  },
  "app/(app)/[org]/[ws]/new-chat.tsx": { NewChat: SCREEN_BODY },
  "app/(app)/[org]/[ws]/new-group.tsx": { NewGroup: SCREEN_BODY },
  "app/(app)/[org]/[ws]/channels.tsx": { ChannelDirectory: SCREEN_BODY },
  "app/(app)/[org]/[ws]/room/[roomId]/index.tsx": { RoomConversation: SCREEN_BODY },
  "app/(app)/[org]/[ws]/room/[roomId]/info.tsx": { RoomInfo: SCREEN_BODY },
  "app/(app)/[org]/[ws]/room/[roomId]/thread/[rootId].tsx": { ThreadConversation: SCREEN_BODY },
};

function routeFiles(dir = "app"): string[] {
  return fs.readdirSync(path.join(appRoot, dir), { withFileTypes: true }).flatMap((entry) => {
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) return routeFiles(rel);
    return /\.tsx?$/.test(entry.name) ? [rel] : [];
  });
}

const DECLARATION = [
  // function X() / export function X() / async function X(); not the default export
  /^(?:export\s+)?(?:async\s+)?function\s+(\w+)/,
  // const X = memo(…) / forwardRef(…)
  /^(?:export\s+)?const\s+(\w+)\s*=\s*(?:React\.)?(?:memo|forwardRef)\s*\(/,
  // const X = (…) => / async (…) => / x => — a component or hook written as an arrow
  /^(?:export\s+)?const\s+(\w+)\s*(?::[^=]+)?=\s*(?:async\s*)?(?:\([^)]*\)|\w+)\s*(?::[^=]+)?=>/,
];

/** The top-level functions, components and hooks a source defines, its default export aside. */
function declaredNames(source: string): string[] {
  return source.split("\n").flatMap((line) => {
    if (/^export\s+default\s/.test(line)) return [];
    for (const pattern of DECLARATION) {
      const match = pattern.exec(line);
      if (match?.[1]) return [match[1]];
    }
    return [];
  });
}

describe("route files", () => {
  it("reads every kind of declaration that could hold a component", () => {
    const source = [
      "export default function Screen() {}",
      "function Row() {}",
      "export async function load() {}",
      "const Item = memo(function Item() {});",
      "const Strip = ({ people }: Props) => null;",
      "export const useThing = async () => 1;",
      "const LIMIT = 5;",
      "  function nested() {}",
    ].join("\n");
    expect(declaredNames(source)).toEqual(["Row", "load", "Item", "Strip", "useThing"]);
  });

  it("define only their default export and the listed composition", () => {
    const stray: string[] = [];
    for (const file of routeFiles()) {
      const allowed = ALLOWED[file] ?? {};
      for (const name of declaredNames(fs.readFileSync(path.join(appRoot, file), "utf8"))) {
        if (!(name in allowed)) stray.push(`${file} › ${name}: move it to components/ (jest) or lib/ (vitest)`);
      }
    }
    expect(stray).toEqual([]);
  });

  it("list nothing that is gone", () => {
    const gone: string[] = [];
    for (const [file, names] of Object.entries(ALLOWED)) {
      const full = path.join(appRoot, file);
      const declared = fs.existsSync(full) ? declaredNames(fs.readFileSync(full, "utf8")) : [];
      for (const name of Object.keys(names)) if (!declared.includes(name)) gone.push(`${file} › ${name}`);
    }
    expect(gone).toEqual([]);
  });
});
