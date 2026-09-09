import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { applyVerificationOverlay } from "./generate-task-parity-manifest.mjs";

const path = new URL("../docs/parity/tasks-work-management.json", import.meta.url);
const overlayPath = new URL("../docs/parity/tasks-work-management.slice1-verification.json", import.meta.url);
const slice2OverlayPath = new URL("../docs/parity/tasks-work-management.slice2-verification.json", import.meta.url);
const slice3OverlayPath = new URL("../docs/parity/tasks-work-management.slice3-verification.json", import.meta.url);
const slice4OverlayPath = new URL("../docs/parity/tasks-work-management.slice4-verification.json", import.meta.url);
const slice5OverlayPath = new URL("../docs/parity/tasks-work-management.slice5-verification.json", import.meta.url);
const slice6OverlayPath = new URL("../docs/parity/tasks-work-management.slice6-verification.json", import.meta.url);
const generator = fileURLToPath(new URL("./generate-task-parity-manifest.mjs", import.meta.url));
const execFile = promisify(execFileCallback);
const capabilityIDs = [
  "capability:tasks.agent_runs",
  "capability:tasks.squads",
  "capability:tasks.vcs",
  "capability:tasks.local_workdir",
  "capability:desktop.host",
  "capability:mobile.host",
];
const slice2ApiSources = [
  "packages/core/api/client.ts",
  "packages/core/api/schemas.ts",
  "packages/core/issue-statuses/mutations.ts",
  "packages/core/issue-statuses/queries.ts",
  "packages/core/issue-views/mutations.ts",
  "packages/core/issue-views/queries.ts",
  "packages/core/issues/batch.ts",
  "packages/core/issues/cache-coordinator.ts",
  "packages/core/issues/mutations.ts",
  "packages/core/issues/queries.ts",
  "packages/core/projects/mutations.ts",
  "packages/core/projects/queries.ts",
  "server/internal/handler/issue.go",
  "server/internal/handler/issue_table_query.go",
  "server/internal/handler/issue_view.go",
  "server/internal/handler/project.go",
  "server/internal/service/issue.go",
];
const slice3UiSources = [
  "packages/views/issues/components/batch-action-toolbar.test.tsx",
  "packages/views/issues/components/batch-action-toolbar.tsx",
  "packages/views/issues/components/board-view.tsx",
  "packages/views/issues/components/filter-chips-bar.tsx",
  "packages/views/issues/components/gantt-view.tsx",
  "packages/views/issues/components/issues-header.tsx",
  "packages/views/issues/components/issues-page.test.tsx",
  "packages/views/issues/components/issues-page.tsx",
  "packages/views/issues/components/list-view.test.tsx",
  "packages/views/issues/components/list-view.tsx",
  "packages/views/issues/components/manage-views-dialog.tsx",
  "packages/views/issues/components/save-view-dialog.test.tsx",
  "packages/views/issues/components/save-view-dialog.tsx",
  "packages/views/issues/components/swimlane-view.test.tsx",
  "packages/views/issues/components/swimlane-view.tsx",
  "packages/views/issues/components/table-view-model.test.ts",
  "packages/views/issues/components/table-view-model.ts",
  "packages/views/issues/components/table-view.tsx",
  "packages/views/issues/components/view-bar-popover.tsx",
  "packages/views/issues/components/view-bar.tsx",
  "packages/views/issues/surface/actions-context.tsx",
  "packages/views/issues/surface/issue-surface.test.tsx",
  "packages/views/issues/surface/issue-surface.tsx",
  "packages/views/issues/surface/selection-context.tsx",
  "packages/views/issues/surface/types.ts",
  "packages/views/issues/surface/use-issue-group-branches.ts",
  "packages/views/issues/surface/use-issue-surface-controller.ts",
  "packages/views/issues/surface/use-issue-surface-data.ts",
  "packages/views/my-issues/components/my-issues-header.tsx",
  "packages/views/my-issues/components/my-issues-page.tsx",
  "packages/views/my-issues/index.ts",
];
const slice4ProjectsSources = [
  "apps/web/app/[workspaceSlug]/(dashboard)/projects/[id]/page.tsx",
  "apps/web/app/[workspaceSlug]/(dashboard)/projects/page.tsx",
  "packages/core/projects/config.ts",
  "packages/core/projects/stores/view-store.test.ts",
  "packages/core/projects/stores/view-store.ts",
  "packages/views/projects/components/local-directory-hint.tsx",
  "packages/views/projects/components/project-badge.tsx",
  "packages/views/projects/components/project-detail.test.tsx",
  "packages/views/projects/components/project-detail.tsx",
  "packages/views/projects/components/project-icon.tsx",
  "packages/views/projects/components/project-issue-metrics.test.ts",
  "packages/views/projects/components/project-issue-metrics.ts",
  "packages/views/projects/components/project-resources-rename.test.tsx",
  "packages/views/projects/components/project-resources-section.tsx",
  "packages/views/projects/components/projects-page.test.tsx",
  "packages/views/projects/components/projects-page.tsx",
];
const slice5DetailSources = [
  "apps/web/app/[workspaceSlug]/(dashboard)/issues/[id]/page.tsx",
  "packages/views/editor/attachment-preview-modal.test.tsx",
  "packages/views/editor/attachment.test.tsx",
  "packages/views/editor/attachment.tsx",
  "packages/views/editor/bubble-menu.test.tsx",
  "packages/views/editor/bubble-menu.tsx",
  "packages/views/editor/content-editor-current-issue.test.tsx",
  "packages/views/editor/content-editor.tsx",
  "packages/views/editor/extensions/file-card.test.tsx",
  "packages/views/editor/extensions/index.ts",
  "packages/views/editor/extensions/issue-identifier-autolink.test.ts",
  "packages/views/editor/extensions/issue-identifier-autolink.ts",
  "packages/views/editor/extensions/markdown-paste.test.ts",
  "packages/views/editor/extensions/mention-suggestion.test.tsx",
  "packages/views/editor/extensions/mention-suggestion.tsx",
  "packages/views/editor/extensions/mention-view.test.tsx",
  "packages/views/editor/extensions/mention-view.tsx",
  "packages/views/editor/extensions/slash-command-suggestion.tsx",
  "packages/views/editor/html-attachment-preview.test.tsx",
  "packages/views/editor/image-sequence-context.test.tsx",
  "packages/views/editor/mermaid-viewer.test.tsx",
  "packages/views/editor/readonly-content.test.tsx",
  "packages/views/editor/readonly-content.tsx",
  "packages/views/editor/utils/issue-identifiers.test.ts",
  "packages/views/editor/utils/link-handler.test.ts",
  "packages/views/editor/utils/link-handler.ts",
  "packages/views/editor/utils/preprocess-links.test.ts",
  "packages/views/editor/utils/preprocess.ts",
  "packages/views/issues/actions/__tests__/issue-actions-menu.test.tsx",
  "packages/views/issues/actions/__tests__/use-issue-actions.test.tsx",
  "packages/views/issues/actions/index.ts",
  "packages/views/issues/actions/issue-actions-context-menu.tsx",
  "packages/views/issues/actions/issue-actions-dropdown.tsx",
  "packages/views/issues/actions/issue-actions-menu-items.tsx",
  "packages/views/issues/actions/run-confirm-gate.test.ts",
  "packages/views/issues/actions/run-confirm-gate.ts",
  "packages/views/issues/actions/use-issue-actions.ts",
  "packages/views/issues/components/comment-card-edit-gate.test.tsx",
  "packages/views/issues/components/comment-card.test.tsx",
  "packages/views/issues/components/comment-card.tsx",
  "packages/views/issues/components/comment-composers.test.tsx",
  "packages/views/issues/components/comment-input.tsx",
  "packages/views/issues/components/comment-trigger-chips.test.tsx",
  "packages/views/issues/components/comment-trigger-chips.tsx",
  "packages/views/issues/components/execution-log-section.test.tsx",
  "packages/views/issues/components/execution-log-section.tsx",
  "packages/views/issues/components/index.ts",
  "packages/views/issues/components/issue-agent-activity-indicator.test.tsx",
  "packages/views/issues/components/issue-agent-activity-indicator.tsx",
  "packages/views/issues/components/issue-agent-header-chip.test.tsx",
  "packages/views/issues/components/issue-agent-header-chip.tsx",
  "packages/views/issues/components/issue-detail-route.test.tsx",
  "packages/views/issues/components/issue-detail-route.tsx",
  "packages/views/issues/components/issue-detail.test.tsx",
  "packages/views/issues/components/issue-detail.tsx",
  "packages/views/issues/components/issue-mention-card.test.tsx",
  "packages/views/issues/components/issue-mention-card.tsx",
  "packages/views/issues/components/pickers/actor-property-picker.test.ts",
  "packages/views/issues/components/pickers/actor-property-picker.tsx",
  "packages/views/issues/components/pickers/assignee-picker.keyboard.test.tsx",
  "packages/views/issues/components/pickers/assignee-picker.tsx",
  "packages/views/issues/components/pickers/custom-property-picker.test.ts",
  "packages/views/issues/components/pickers/custom-property-picker.tsx",
  "packages/views/issues/components/pickers/deferred-trigger.test.tsx",
  "packages/views/issues/components/pickers/due-date-picker.tsx",
  "packages/views/issues/components/pickers/index.ts",
  "packages/views/issues/components/pickers/label-picker.tsx",
  "packages/views/issues/components/pickers/priority-picker.tsx",
  "packages/views/issues/components/pickers/property-picker.tsx",
  "packages/views/issues/components/pickers/stage-picker.test.tsx",
  "packages/views/issues/components/pickers/stage-picker.tsx",
  "packages/views/issues/components/pickers/start-date-picker.tsx",
  "packages/views/issues/components/pickers/status-picker.test.tsx",
  "packages/views/issues/components/pickers/status-picker.tsx",
  "packages/views/issues/components/pull-request-list.test.tsx",
  "packages/views/issues/components/pull-request-list.tsx",
  "packages/views/issues/components/quick-actions-section.test.tsx",
  "packages/views/issues/components/quick-actions-section.tsx",
  "packages/views/issues/components/source-context-comment-list.tsx",
  "packages/views/issues/components/status-icon.test.tsx",
  "packages/views/issues/components/status-icon.tsx",
  "packages/views/issues/components/sub-issues-agent-working-chip.test.tsx",
  "packages/views/issues/components/sub-issues-agent-working-chip.tsx",
  "packages/views/issues/components/terminate-task-confirm-dialog.tsx",
  "packages/views/issues/components/use-comment-uploads.ts",
  "packages/views/issues/current-issue-render-context.tsx",
  "packages/views/issues/hooks/use-comment-trigger-preview.test.ts",
  "packages/views/issues/hooks/use-comment-trigger-preview.ts",
  "packages/views/issues/hooks/use-issue-detail-scroll-restore.test.tsx",
  "packages/views/issues/hooks/use-issue-detail-scroll-restore.ts",
  "packages/views/issues/hooks/use-issue-timeline.test.tsx",
  "packages/views/issues/hooks/use-issue-timeline.ts",
  "packages/views/issues/hooks/use-issue-trigger-preview.ts",
  "packages/views/issues/hooks/use-quick-action-menu.ts",
  "packages/views/issues/hooks/use-sticky-composer.test.tsx",
  "packages/views/issues/hooks/use-sticky-composer.ts",
];
const slice6AgentSources = [
  "apps/web/app/[workspaceSlug]/(dashboard)/runtimes/[id]/page.tsx",
  "apps/web/app/[workspaceSlug]/(dashboard)/runtimes/[id]/runtime/[runtimeId]/page.tsx",
  "apps/web/app/[workspaceSlug]/(dashboard)/runtimes/page.tsx",
  "apps/web/app/[workspaceSlug]/(dashboard)/squads/[id]/page.tsx",
  "apps/web/app/[workspaceSlug]/(dashboard)/squads/page.tsx",
  "packages/views/issues/actions/__tests__/issue-actions-menu.test.tsx",
  "packages/views/issues/actions/__tests__/use-issue-actions.test.tsx",
  "packages/views/issues/actions/index.ts",
  "packages/views/issues/actions/issue-actions-context-menu.tsx",
  "packages/views/issues/actions/issue-actions-dropdown.tsx",
  "packages/views/issues/actions/issue-actions-menu-items.tsx",
  "packages/views/issues/actions/run-confirm-gate.test.ts",
  "packages/views/issues/actions/run-confirm-gate.ts",
  "packages/views/issues/actions/use-issue-actions.ts",
  "packages/views/issues/blocked-trigger-copy.test.ts",
  "packages/views/issues/blocked-trigger-copy.ts",
  "packages/views/issues/components/comment-trigger-chips.test.tsx",
  "packages/views/issues/components/comment-trigger-chips.tsx",
  "packages/views/issues/components/execution-log-section.test.tsx",
  "packages/views/issues/components/execution-log-section.tsx",
  "packages/views/issues/components/issue-agent-activity-indicator.test.tsx",
  "packages/views/issues/components/issue-agent-activity-indicator.tsx",
  "packages/views/issues/components/issue-agent-header-chip.test.tsx",
  "packages/views/issues/components/issue-agent-header-chip.tsx",
  "packages/views/issues/components/issue-usage-dialog.test.tsx",
  "packages/views/issues/components/issue-usage-dialog.tsx",
  "packages/views/issues/components/pull-request-list.test.tsx",
  "packages/views/issues/components/pull-request-list.tsx",
  "packages/views/issues/components/quick-actions-section.test.tsx",
  "packages/views/issues/components/quick-actions-section.tsx",
  "packages/views/issues/components/sub-issues-agent-working-chip.test.tsx",
  "packages/views/issues/components/sub-issues-agent-working-chip.tsx",
  "packages/views/issues/components/task-run-labels.ts",
  "packages/views/issues/components/terminate-task-confirm-dialog.tsx",
  "packages/views/issues/components/workspace-agent-working-chip.test.tsx",
  "packages/views/issues/components/workspace-agent-working-chip.tsx",
  "packages/views/issues/hooks/use-comment-trigger-preview.test.ts",
  "packages/views/issues/hooks/use-comment-trigger-preview.ts",
  "packages/views/issues/hooks/use-issue-trigger-preview.ts",
  "packages/views/issues/hooks/use-quick-action-menu.ts",
  "packages/views/layout/app-sidebar.tsx",
  "packages/views/locales/en/runtimes.json",
  "packages/views/locales/en/squads.json",
  "packages/views/projects/components/local-directory-hint.test.tsx",
  "packages/views/projects/components/local-directory-hint.tsx",
  "packages/views/projects/components/project-resources-section.tsx",
  "packages/views/runtimes/components/charts/activity-heatmap.test.tsx",
  "packages/views/runtimes/components/charts/activity-heatmap.tsx",
  "packages/views/runtimes/components/charts/daily-cost-chart.tsx",
  "packages/views/runtimes/components/charts/daily-errors-chart.tsx",
  "packages/views/runtimes/components/charts/daily-tasks-chart.tsx",
  "packages/views/runtimes/components/charts/daily-time-chart.tsx",
  "packages/views/runtimes/components/charts/daily-tokens-chart.tsx",
  "packages/views/runtimes/components/charts/failure-class-visuals.ts",
  "packages/views/runtimes/components/charts/index.ts",
  "packages/views/runtimes/components/charts/weekly-cost-chart.tsx",
  "packages/views/runtimes/components/charts/weekly-errors-chart.tsx",
  "packages/views/runtimes/components/charts/weekly-tasks-chart.tsx",
  "packages/views/runtimes/components/charts/weekly-time-chart.tsx",
  "packages/views/runtimes/components/charts/weekly-tokens-chart.tsx",
  "packages/views/runtimes/components/cloud-runtime-dialog.tsx",
  "packages/views/runtimes/components/compact-runtime-row.tsx",
  "packages/views/runtimes/components/connect-remote-dialog.test.tsx",
  "packages/views/runtimes/components/connect-remote-dialog.tsx",
  "packages/views/runtimes/components/custom-pricing-dialog.tsx",
  "packages/views/runtimes/components/delete-runtime-dialog.test.tsx",
  "packages/views/runtimes/components/delete-runtime-dialog.tsx",
  "packages/views/runtimes/components/delete-runtime-profile-dialog.tsx",
  "packages/views/runtimes/components/index.ts",
  "packages/views/runtimes/components/machine-cli-section.test.tsx",
  "packages/views/runtimes/components/machine-cli-section.tsx",
  "packages/views/runtimes/components/mika-runtime-choice.test.tsx",
  "packages/views/runtimes/components/mika-runtime-choice.tsx",
  "packages/views/runtimes/components/pending-runtime.test.ts",
  "packages/views/runtimes/components/pending-runtime.ts",
  "packages/views/runtimes/components/provider-logo.test.tsx",
  "packages/views/runtimes/components/provider-logo.tsx",
  "packages/views/runtimes/components/rename-machine-dialog.tsx",
  "packages/views/runtimes/components/runtime-detail-page.tsx",
  "packages/views/runtimes/components/runtime-detail-visibility.test.tsx",
  "packages/views/runtimes/components/runtime-detail.tsx",
  "packages/views/runtimes/components/runtime-docs.test.ts",
  "packages/views/runtimes/components/runtime-docs.ts",
  "packages/views/runtimes/components/runtime-list.test.ts",
  "packages/views/runtimes/components/runtime-list.tsx",
  "packages/views/runtimes/components/runtime-machines.test.ts",
  "packages/views/runtimes/components/runtime-machines.ts",
  "packages/views/runtimes/components/runtime-profile-catalog.test.ts",
  "packages/views/runtimes/components/runtime-profile-catalog.ts",
  "packages/views/runtimes/components/runtime-profiles-dialog.test.tsx",
  "packages/views/runtimes/components/runtime-profiles-dialog.tsx",
  "packages/views/runtimes/components/runtime-row-menu.test.tsx",
  "packages/views/runtimes/components/runtime-settings-page.test.ts",
  "packages/views/runtimes/components/runtime-settings-page.tsx",
  "packages/views/runtimes/components/runtimes-page.tsx",
  "packages/views/runtimes/components/shared.tsx",
  "packages/views/runtimes/components/update-section.test.tsx",
  "packages/views/runtimes/components/update-section.tsx",
  "packages/views/runtimes/components/usage-section.test.tsx",
  "packages/views/runtimes/components/usage-section.tsx",
  "packages/views/runtimes/index.ts",
  "packages/views/runtimes/utils.test.ts",
  "packages/views/runtimes/utils.ts",
  "packages/views/squads/components/index.ts",
  "packages/views/squads/components/squad-detail-page.tsx",
  "packages/views/squads/components/squad-profile-card.tsx",
  "packages/views/squads/components/squads-page.tsx",
  "packages/views/squads/index.ts",
];
const pendingKeys = [
  "disposition",
  "kind",
  "owner_issue",
  "source_path",
  "target_path",
  "verification_state",
];
const verifiedKeys = [
  "disposition",
  "evidence_commit",
  "evidence_path",
  "kind",
  "owner_issue",
  "source_path",
  "target_path",
  "verification_state",
];

test("Tasks parity manifest pins and classifies the complete baseline", async () => {
  const manifest = JSON.parse(await readFile(path, "utf8"));
  const overlay = JSON.parse(await readFile(overlayPath, "utf8"));
  const slice2Overlay = JSON.parse(await readFile(slice2OverlayPath, "utf8"));
  const slice3Overlay = JSON.parse(await readFile(slice3OverlayPath, "utf8"));
  const slice4Overlay = JSON.parse(await readFile(slice4OverlayPath, "utf8"));
  const slice5Overlay = JSON.parse(await readFile(slice5OverlayPath, "utf8"));
  const slice6Overlay = JSON.parse(await readFile(slice6OverlayPath, "utf8"));
  assert.equal(manifest.schema_version, 1);
  assert.equal(manifest.baseline_commit, "3d37828e9");
  assert.equal(manifest.entries.length, 1531);
  assert.equal(overlay.schema_version, 1);
  assert.equal(overlay.owner_issue, "UNI-495");
  assert.deepEqual(
    overlay.entries.map((entry) => entry.source_path).sort(),
    [...capabilityIDs].sort(),
  );
  assert.equal(slice2Overlay.schema_version, 1);
  assert.equal(slice2Overlay.owner_issue, "UNI-497");
  assert.deepEqual(
    slice2Overlay.entries.map((entry) => entry.source_path).sort(),
    [...slice2ApiSources].sort(),
  );
  assert.equal(slice3Overlay.schema_version, 1);
  assert.equal(slice3Overlay.owner_issue, "UNI-500");
  assert.deepEqual(
    slice3Overlay.entries.map((entry) => entry.source_path).sort(),
    [...slice3UiSources].sort(),
  );
  assert.equal(slice4Overlay.schema_version, 1);
  assert.equal(slice4Overlay.owner_issue, "UNI-502");
  assert.deepEqual(
    slice4Overlay.entries.map((entry) => entry.source_path).sort(),
    [...slice4ProjectsSources].sort(),
  );
  assert.equal(slice5Overlay.schema_version, 1);
  assert.equal(slice5Overlay.owner_issue, "UNI-505");
  assert.deepEqual(
    slice5Overlay.entries.map((entry) => entry.source_path).sort(),
    [...slice5DetailSources].sort(),
  );
  assert.equal(slice6Overlay.schema_version, 1);
  assert.equal(slice6Overlay.owner_issue, "UNI-519");
  assert.deepEqual(
    slice6Overlay.entries.map((entry) => entry.source_path).sort(),
    [...slice6AgentSources].sort(),
  );

  const sources = manifest.entries.map((entry) => entry.source_path);
  const sourceEntries = manifest.entries.filter((entry) => entry.kind !== "capability");
  const capabilities = manifest.entries.filter((entry) => entry.kind === "capability");
  assert.equal(sourceEntries.length, 1525);
  assert.deepEqual(capabilities.map((entry) => entry.source_path), capabilityIDs);
  assert.equal(new Set(sources).size, sources.length);

  const verifiedSources = new Set([
    ...overlay.entries.map((entry) => entry.source_path),
    ...slice2Overlay.entries.map((entry) => entry.source_path),
    ...slice3Overlay.entries.map((entry) => entry.source_path),
    ...slice4Overlay.entries.map((entry) => entry.source_path),
    ...slice5Overlay.entries.map((entry) => entry.source_path),
    ...slice6Overlay.entries.map((entry) => entry.source_path),
  ]);
  for (const entry of [
    ...overlay.entries,
    ...slice2Overlay.entries,
    ...slice3Overlay.entries,
    ...slice4Overlay.entries,
    ...slice5Overlay.entries,
    ...slice6Overlay.entries,
  ]) {
    assert.equal(entry.verification_state, "verified");
    assert.match(entry.evidence_path, /\S/);
    assert.match(entry.evidence_commit, /^[0-9a-f]{7,40}$/);
  }

  for (const entry of manifest.entries) {
    assert.match(entry.source_path, /\S/);
    assert.match(entry.target_path, /\S/);
    assert.equal(entry.target_path.toLowerCase().includes(manifest.source_product.toLowerCase()), false);
    assert.equal(entry.target_path.toLowerCase().includes("issue"), false);
    assert.ok(["source", "route", "test", "locale", "capability"].includes(entry.kind));
    assert.ok(["ported", "adapted", "stubbed"].includes(entry.disposition));
    assert.equal(entry.owner_issue, "UNI-426");
    if (verifiedSources.has(entry.source_path)) {
      assert.deepEqual(Object.keys(entry).sort(), verifiedKeys);
      assert.equal(entry.verification_state, "verified");
      assert.match(entry.evidence_path, /\S/);
      assert.match(entry.evidence_commit, /^[0-9a-f]{7,40}$/);
    } else {
      assert.deepEqual(Object.keys(entry).sort(), pendingKeys);
      assert.equal(entry.verification_state, "pending");
    }
  }
  assert.equal(
    createHash("sha256").update(JSON.stringify(manifest.entries)).digest("hex"),
    "95f61f0f2aba306bdfaae378828a91af0ce452db6b0819d97cef69efcee76d4a",
  );

  for (const route of [
    "apps/web/app/[workspaceSlug]/(dashboard)/issues/page.tsx",
    "apps/web/app/[workspaceSlug]/(dashboard)/my-issues/page.tsx",
    "apps/web/app/[workspaceSlug]/(dashboard)/projects/page.tsx",
  ]) {
    assert.ok(sources.includes(route), `missing route ${route}`);
  }
  for (const [sourcePath, targetPath] of [
    [
      "apps/mobile/data/mutations/issues.ts",
      "apps/mobile/data/mutations/tasks.ts",
    ],
    [
      "apps/web/app/[workspaceSlug]/(dashboard)/issues/[id]/page.tsx",
      "apps/web/app/[workspaceSlug]/(dashboard)/tasks/[id]/page.tsx",
    ],
    [
      "packages/core/issue-statuses/hooks.ts",
      "packages/core/task-statuses/hooks.ts",
    ],
  ]) {
    assert.equal(manifest.entries.find((entry) => entry.source_path === sourcePath)?.target_path, targetPath);
  }
  assert.equal(manifest.entries.some((entry) => entry.disposition === "stubbed"), true);
});

test("Task parity generator emits a byte-stable manifest from a fixed Git fixture", async (t) => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), "task-parity-manifest-"));
  t.after(() => rm(fixtureRoot, { force: true, recursive: true }));

  async function addFile(relativePath, content) {
    const file = join(fixtureRoot, relativePath);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, content);
  }

  await execFile("git", ["init", "--quiet", fixtureRoot]);
  await execFile("git", ["-C", fixtureRoot, "config", "user.email", "test@example.com"]);
  await execFile("git", ["-C", fixtureRoot, "config", "user.name", "Task Parity Test"]);
  await addFile("packages/core/issues/hooks.ts", "export const Issue = 'issue';\n");
  await addFile("packages/fixture-brand/issue.ts", "export const Issue = 'brand';\n");
  await addFile("apps/web/app/[workspaceSlug]/(dashboard)/issues/page.tsx", "export default function Page() {}\n");
  await addFile("server/internal/issue-agent-task.go", "package internal\n");
  await execFile("git", ["-C", fixtureRoot, "add", "."]);
  await execFile("git", ["-C", fixtureRoot, "commit", "--quiet", "-m", "fixture"]);
  const { stdout } = await execFile("git", ["-C", fixtureRoot, "rev-parse", "HEAD"]);
  const baseline = stdout.trim();
  const first = join(fixtureRoot, "first.json");
  const second = join(fixtureRoot, "second.json");
  const args = [generator, "--source-root", fixtureRoot, "--baseline", baseline, "--source-brand", "fixture-brand"];

  await execFile(process.execPath, [...args, "--output", first]);
  await execFile(process.execPath, [...args, "--output", second]);

  assert.equal(await readFile(first, "utf8"), await readFile(second, "utf8"));
  const generated = JSON.parse(await readFile(first, "utf8"));
  assert.equal(generated.baseline_commit, baseline);
  assert.deepEqual(generated.entries.map((entry) => entry.source_path), [
    "apps/web/app/[workspaceSlug]/(dashboard)/issues/page.tsx",
    "packages/core/issues/hooks.ts",
    "packages/fixture-brand/issue.ts",
    "server/internal/issue-agent-task.go",
    ...capabilityIDs,
  ]);
  assert.equal(generated.entries.find((entry) => entry.source_path === "packages/fixture-brand/issue.ts")?.target_path, "packages/uniwork/task.ts");
  assert.equal(generated.entries.find((entry) => entry.source_path === "server/internal/issue-agent-task.go")?.disposition, "stubbed");
  assert.equal(generated.entries.every((entry) => entry.verification_state === "pending"), true);
});

test("slice-1 verification overlay marks only owned capability entries", async () => {
  const overlay = JSON.parse(await readFile(overlayPath, "utf8"));
  const pending = {
    source_path: "packages/core/issues/hooks.ts",
    target_path: "packages/core/tasks/hooks.ts",
    kind: "source",
    disposition: "adapted",
    verification_state: "pending",
    owner_issue: "UNI-426",
  };
  const capability = {
    source_path: "capability:tasks.vcs",
    target_path: "capability:tasks.vcs",
    kind: "capability",
    disposition: "stubbed",
    verification_state: "pending",
    owner_issue: "UNI-426",
  };
  const merged = applyVerificationOverlay([pending, capability], overlay);
  assert.equal(merged[0].verification_state, "pending");
  assert.equal(merged[0].evidence_path, undefined);
  assert.equal(merged[1].verification_state, "verified");
  assert.equal(merged[1].evidence_path, "server/internal/workcapability/catalogue.go");
  assert.equal(merged[1].evidence_commit, "017d8be7a9e83eab6ba0009379cf6c5cdddecd12");
});

test("slice-2 verification overlay marks only owned API entries", async () => {
  const overlay = JSON.parse(await readFile(slice2OverlayPath, "utf8"));
  const pending = {
    source_path: "apps/web/app/[workspaceSlug]/(dashboard)/issues/page.tsx",
    target_path: "apps/web/app/[workspaceSlug]/(dashboard)/tasks/page.tsx",
    kind: "route",
    disposition: "adapted",
    verification_state: "pending",
    owner_issue: "UNI-426",
  };
  const api = {
    source_path: "packages/core/api/client.ts",
    target_path: "packages/core/api/client.ts",
    kind: "source",
    disposition: "adapted",
    verification_state: "pending",
    owner_issue: "UNI-426",
  };
  const merged = applyVerificationOverlay([pending, api], overlay);
  assert.equal(merged[0].verification_state, "pending");
  assert.equal(merged[0].evidence_path, undefined);
  assert.equal(merged[1].verification_state, "verified");
  assert.equal(merged[1].evidence_path, "docs/parity/tasks-api-client-core-routes.json");
  assert.equal(merged[1].evidence_commit, "eacfb8e90dbe017adeb200d4e284a4f4a051262a");
});

test("slice-3 verification overlay marks only owned UI entries", async () => {
  const overlay = JSON.parse(await readFile(slice3OverlayPath, "utf8"));
  const pending = {
    source_path: "packages/core/api/client.ts",
    target_path: "packages/core/api/client.ts",
    kind: "source",
    disposition: "adapted",
    verification_state: "pending",
    owner_issue: "UNI-426",
  };
  const ui = {
    source_path: "packages/views/issues/surface/issue-surface.tsx",
    target_path: "packages/views/tasks/surface/task-surface.tsx",
    kind: "source",
    disposition: "adapted",
    verification_state: "pending",
    owner_issue: "UNI-426",
  };
  const merged = applyVerificationOverlay([pending, ui], overlay);
  assert.equal(merged[0].verification_state, "pending");
  assert.equal(merged[0].evidence_path, undefined);
  assert.equal(merged[1].verification_state, "verified");
  assert.equal(merged[1].evidence_path, "packages/views/tasks/surface/task-surface.tsx");
  assert.match(merged[1].evidence_commit, /^[0-9a-f]{7,40}$/);
});

test("slice-4 verification overlay marks only owned projects entries", async () => {
  const overlay = JSON.parse(await readFile(slice4OverlayPath, "utf8"));
  const pending = {
    source_path: "packages/views/issues/surface/issue-surface.tsx",
    target_path: "packages/views/tasks/surface/task-surface.tsx",
    kind: "source",
    disposition: "adapted",
    verification_state: "pending",
    owner_issue: "UNI-426",
  };
  const projects = {
    source_path: "packages/views/projects/components/projects-page.tsx",
    target_path: "packages/views/projects/components/projects-page.tsx",
    kind: "source",
    disposition: "adapted",
    verification_state: "pending",
    owner_issue: "UNI-426",
  };
  const merged = applyVerificationOverlay([pending, projects], overlay);
  assert.equal(merged[0].verification_state, "pending");
  assert.equal(merged[0].evidence_path, undefined);
  assert.equal(merged[1].verification_state, "verified");
  assert.equal(merged[1].evidence_path, "packages/views/projects/projects-list-page.tsx");
  assert.match(merged[1].evidence_commit, /^[0-9a-f]{7,40}$/);
});

test("slice-5 verification overlay marks only owned detail entries", async () => {
  const overlay = JSON.parse(await readFile(slice5OverlayPath, "utf8"));
  const pending = {
    source_path: "packages/views/projects/components/projects-page.tsx",
    target_path: "packages/views/projects/components/projects-page.tsx",
    kind: "source",
    disposition: "adapted",
    verification_state: "pending",
    owner_issue: "UNI-426",
  };
  const detail = {
    source_path: "packages/views/editor/content-editor.tsx",
    target_path: "packages/views/editor/content-editor.tsx",
    kind: "source",
    disposition: "ported",
    verification_state: "pending",
    owner_issue: "UNI-426",
  };
  const merged = applyVerificationOverlay([pending, detail], overlay);
  assert.equal(merged[0].verification_state, "pending");
  assert.equal(merged[0].evidence_path, undefined);
  assert.equal(merged[1].verification_state, "verified");
  assert.equal(merged[1].evidence_path, "packages/views/editor/content-editor.tsx");
  assert.match(merged[1].evidence_commit, /^[0-9a-f]{7,40}$/);
});

test("slice-6 verification overlay marks only owned agent-integration entries", async () => {
  const overlay = JSON.parse(await readFile(slice6OverlayPath, "utf8"));
  const pending = {
    source_path: "packages/views/editor/content-editor.tsx",
    target_path: "packages/views/editor/content-editor.tsx",
    kind: "source",
    disposition: "ported",
    verification_state: "pending",
    owner_issue: "UNI-426",
  };
  const agent = {
    source_path: "packages/views/layout/app-sidebar.tsx",
    target_path: "packages/views/layout/app-sidebar.tsx",
    kind: "source",
    disposition: "adapted",
    verification_state: "pending",
    owner_issue: "UNI-426",
  };
  const merged = applyVerificationOverlay([pending, agent], overlay);
  assert.equal(merged[0].verification_state, "pending");
  assert.equal(merged[0].evidence_path, undefined);
  assert.equal(merged[1].verification_state, "verified");
  assert.equal(merged[1].evidence_path, "packages/views/layout/app-sidebar.tsx");
  assert.match(merged[1].evidence_commit, /^[0-9a-f]{7,40}$/);
});
