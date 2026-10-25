import { test } from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { canonicalFor, lucideDeprecatedAliases } from "./lucide-aliases.mjs";

const committed = JSON.parse(readFileSync("packages/eslint-config/lucide-aliases.json", "utf8"));

// The ESLint guard (packages/eslint-config/base.js › lucideAliasPaths) reads
// this list; a lucide-react bump that renames icons must refresh it.
test("the committed alias list matches the installed lucide-react", () => {
  assert.deepEqual(committed, lucideDeprecatedAliases(), "run: pnpm generate:lucide-aliases");
});

// Lint reports without failing at GATE_LEVEL=fast (ADR 0014), so the import
// ban is also held here, where it fails at every level.
test("no source file imports a deprecated lucide alias", () => {
  const files = execSync(
    `git ls-files -- '*.ts' '*.tsx' '*.mts' '*.js' '*.jsx' '*.mjs' | grep -v '^packages/office-upstream/upstream/' || true`,
    { encoding: "utf8" },
  ).split("\n").filter(Boolean);
  const importRe = /import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+["']lucide-react["']/g;
  const hits = [];
  for (const file of files) {
    const src = readFileSync(file, "utf8");
    if (!src.includes("lucide-react")) continue;
    for (const match of src.matchAll(importRe)) {
      for (const spec of match[1].split(",")) {
        const name = spec.replace(/^\s*type\s+/, "").split(/\s+as\s+/)[0].trim();
        if (Object.hasOwn(committed, name)) hits.push(`${file}: ${name} → ${canonicalFor(name, committed[name])}`);
      }
    }
  }
  assert.deepEqual(hits, [], `deprecated lucide aliases:\n${hits.join("\n")}`);
});

// One on-screen weight for every Lucide icon (docs/conventions.md › Icons ›
// Stroke): base.css makes the stroke non-scaling at 2.5px.
test("base.css strokes every Lucide icon 2.5px at every size", () => {
  const css = readFileSync("packages/ui/styles/base.css", "utf8");
  assert.match(css, /svg\.lucide \{ stroke-width: 2\.5; \}/);
  assert.match(css, /svg\.lucide :where\([^)]*\) \{ vector-effect: non-scaling-stroke; \}/);
});

// The Lucide icons a file imports, under the local names it renders them by.
function lucideNames(src) {
  const names = new Set();
  for (const match of src.matchAll(/import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+["']lucide-react["']/g)) {
    for (const spec of match[1].split(",")) {
      const local = spec.replace(/^\s*type\s+/, "").split(/\s+as\s+/).pop().trim();
      if (local) names.add(local);
    }
  }
  return names;
}

// Each `<Name …>` tag up to the `>` that closes it: braces and quoted strings
// are skipped, so an arrow function or a `[&>svg]` class does not end it.
function tags(src, name) {
  const out = [];
  for (const m of src.matchAll(new RegExp(`<${name}(?=[\\s/>])`, "g"))) {
    let depth = 0;
    let quote = null;
    let i = m.index + m[0].length;
    for (; i < src.length; i++) {
      const c = src[i];
      if (quote) {
        if (c === quote) quote = null;
      } else if (c === '"' || c === "'" || c === "`") quote = c;
      else if (c === "{") depth++;
      else if (c === "}") depth--;
      else if (c === ">" && depth === 0) break;
    }
    out.push(src.slice(m.index, i));
  }
  return out;
}

// The scale in docs/conventions.md › Icons › Size: 12, 14, 16, 20px, then 24px and up.
const onScale = (n) => ["3", "3.5", "4", "5"].includes(n) || (Number.isInteger(Number(n)) && Number(n) >= 6);

function iconOffences() {
  const files = execSync(`git ls-files -- '*.tsx' | grep -v '^packages/office-upstream/upstream/' || true`, {
    encoding: "utf8",
  })
    .split("\n")
    .filter((file) => file && !/\.(test|stories)\.tsx$/.test(file));
  const stroke = {};
  const size = {};
  for (const file of files) {
    const src = readFileSync(file, "utf8");
    if (!src.includes("lucide-react")) continue;
    for (const name of lucideNames(src)) {
      for (const tag of tags(src, name)) {
        if (/\b(strokeWidth|absoluteStrokeWidth)\b/.test(tag)) stroke[file] = (stroke[file] ?? 0) + 1;
        for (const [, n] of tag.matchAll(/(?:^|[\s"'`:])size-(\d+(?:\.\d+)?)/g)) {
          if (!onScale(n)) size[file] = (size[file] ?? 0) + 1;
        }
      }
    }
  }
  return { stroke, size };
}

// What the icon sweep (UNI-2163) still has to clear. These only shrink: fix a
// file and delete its line, never add one.
const STROKE_BASELINE = {
  "apps/web/platform/unichat-login-gate.tsx": 1,
  "packages/views/auth/auth-controls.tsx": 1,
  "packages/views/auth/locale-switch.tsx": 1,
  "packages/views/auth/password-field.tsx": 2,
  "packages/views/chat/chat-create-reminder-dialog.tsx": 1,
  "packages/views/chat/chat-forward-dialog.tsx": 1,
  "packages/views/chat/chat-poll-message-row.tsx": 1,
  "packages/views/chat/chat-poll-voters-dialog.tsx": 1,
  "packages/views/chat/chat-sidebar-header.tsx": 1,
  "packages/views/chat/chat-sidebar-rows.tsx": 1,
  "packages/views/chat/selected-member-chips.tsx": 1,
  "packages/views/chat/workspace-member-picker.tsx": 1,
  "packages/views/meetings/meeting-background-picker.tsx": 1,
  "packages/views/meetings/meeting-sheet/people-field.tsx": 1,
  "packages/views/onboarding/components/step-sidebar.tsx": 1,
  "packages/views/onboarding/steps/step-welcome.tsx": 1,
  "packages/views/workspace/accept-invite/switch-steps.tsx": 1,
};
const SIZE_BASELINE = {
  "apps/web/platform/unichat-login-gate.tsx": 1,
  "packages/views/chat/channel-directory-sheet.tsx": 1,
  "packages/views/chat/channel-settings-sheet.tsx": 1,
  "packages/views/chat/chat-composer-parts.tsx": 4,
  "packages/views/chat/chat-composer.tsx": 2,
  "packages/views/chat/chat-create-poll-dialog.tsx": 2,
  "packages/views/chat/chat-create-reminder-dialog.tsx": 2,
  "packages/views/chat/chat-form-parts.tsx": 1,
  "packages/views/chat/chat-mention-autocomplete.tsx": 1,
  "packages/views/chat/chat-message-hover-actions.tsx": 4,
  "packages/views/chat/chat-message-menu-items.tsx": 9,
  "packages/views/chat/chat-message-parts.tsx": 4,
  "packages/views/chat/chat-message-search-bar.tsx": 2,
  "packages/views/chat/chat-page-empty-conversation.tsx": 1,
  "packages/views/chat/chat-person-shared-panel.tsx": 1,
  "packages/views/chat/chat-pinned-messages-bar.tsx": 1,
  "packages/views/chat/chat-poll-message-row.tsx": 1,
  "packages/views/chat/chat-post-message-row.tsx": 1,
  "packages/views/chat/chat-room-bulletin-sheet.tsx": 1,
  "packages/views/chat/chat-room-member-actions.tsx": 1,
  "packages/views/chat/chat-settings-ui.tsx": 2,
  "packages/views/chat/chat-sidebar-header.tsx": 3,
  "packages/views/chat/chat-sidebar-parts.tsx": 1,
  "packages/views/chat/chat-sidebar-rows.tsx": 1,
  "packages/views/chat/chat-voice-message-row.tsx": 1,
  "packages/views/chat/create-channel-dialog.tsx": 1,
  "packages/views/chat/dm-settings-sheet.tsx": 1,
  "packages/views/chat/group-settings-sheet.tsx": 1,
  "packages/views/chat/message-task-card.tsx": 2,
  "packages/views/chat/native-chat-panel-bars.tsx": 2,
  "packages/views/chat/selected-member-chips.tsx": 1,
  "packages/views/chat/voice-call-ended-panel.tsx": 1,
  "packages/views/chat/voice-call-floating-panel.tsx": 4,
  "packages/views/chat/voice-call-log-row.tsx": 1,
  "packages/views/chat/voice-call-overlay.tsx": 2,
  "packages/views/chat/voice-call-participants-panel.tsx": 2,
  "packages/views/chat/voice-call-recording-controls.tsx": 1,
  "packages/views/chat/voice-call-recording-dialog.tsx": 2,
  "packages/views/chat/voice-call-recording-player.tsx": 3,
  "packages/views/chat/voice-call-summary-row.tsx": 1,
  "packages/views/chat/workspace-member-picker.tsx": 1,
  "packages/views/chat/workspace-room-member-list.tsx": 1,
  "packages/views/email-hub/email-hub-thread-toolbar.tsx": 4,
  "packages/views/notifications/notification-mark.tsx": 1,
};

test("no Lucide icon sets its own stroke width beyond the shrinking baseline", () => {
  assert.deepEqual(iconOffences().stroke, STROKE_BASELINE, "a Lucide icon's stroke comes from base.css; drop the prop and its baseline line");
});

test("every Lucide icon sits on the size scale beyond the shrinking baseline", () => {
  assert.deepEqual(iconOffences().size, SIZE_BASELINE, "use size-3, 3.5, 4, 5 or 6 and up; fix the call and its baseline line");
});

// A loading glyph is <Spinner /> (packages/ui/components/ui/spinner.tsx): one
// size default, one accessible-name rule and one reduced-motion behaviour.
test("spinners go through Spinner, not a raw LoaderCircle", () => {
  const hits = execSync(
    `git grep -nF "<LoaderCircle" -- 'packages/*.tsx' 'apps/*.tsx' ':!packages/ui/components/ui/spinner.tsx' ':!packages/office-upstream/upstream/**' || true`,
    { encoding: "utf8" },
  ).trim();
  assert.equal(hits, "", `raw spinners:\n${hits}`);
});
