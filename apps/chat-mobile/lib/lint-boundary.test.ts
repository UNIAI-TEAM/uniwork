// Fixture test for the ADR 0011 import boundary in eslint.config.mjs: a
// forbidden import is red, an allowlisted one is green, and types/* is green
// only as `import type`.
import path from "node:path";
import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

const appRoot = path.resolve(__dirname, "..");
const FIXTURE = "lib/__boundary_fixture__.ts";
// The fixture never touches disk, so the type-aware project service must be
// told to lint it with the default project instead of refusing it.
const eslint = new ESLint({
  cwd: appRoot,
  overrideConfig: [{
    files: [FIXTURE],
    languageOptions: { parserOptions: { projectService: { allowDefaultProject: [FIXTURE] } } },
  }],
});

async function boundaryMessages(code: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath: path.join(appRoot, FIXTURE) });
  const messages = result?.messages ?? [];
  // A parse failure would make every "green" case pass vacuously.
  expect(messages.filter((m) => m.fatal)).toEqual([]);
  return messages.filter((m) => m.ruleId === "@typescript-eslint/no-restricted-imports").map((m) => m.message);
}

// The first lintText warms up the type-aware project service (~10 s cold).
describe("ADR 0011 import boundary", { timeout: 60_000 }, () => {
  it.each([
    ['import { useChatRooms } from "@uniwork/core/chat";', /mobile-core-allowlist/],
    ['import { useX } from "@uniwork/core";', /mobile-core-allowlist/],
    ['import { Button } from "@uniwork/views/chat/button";', /never hosts views/],
    ['import { cn } from "@uniwork/ui/lib/utils";', /never hosts views/],
    ['import { useRouter } from "next/navigation";', /never hosts views/],
    ['import { useTheme } from "@react-navigation/native";', /expo-router/],
    ['import { x } from "../../packages/core/x";', /never by relative path/],
    ['import { x } from "@uniwork/core/chat/poll-utils-extra";', /mobile-core-allowlist/],
    ['import { User } from "@uniwork/core/types/user";', /import type/],
  ])("%s is red", async (code, message) => {
    const messages = await boundaryMessages(code);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatch(message);
  });

  it.each([
    'import { parseWithFallback } from "@uniwork/core/api/schema";',
    'import { canManageRoom } from "@uniwork/core/chat/room-permissions-utils";',
    'import type { User } from "@uniwork/core/types/user";',
    'import { clsx } from "clsx";',
  ])("%s is green", async (code) => {
    expect(await boundaryMessages(code)).toEqual([]);
  });
});
