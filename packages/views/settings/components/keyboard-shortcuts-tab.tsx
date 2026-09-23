"use client";

import { useMemo, useState, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import { Keyboard, RotateCcw, Search, X } from "lucide-react";
import {
  SHORTCUT_ACTIONS,
  createShortcutChord,
  findShortcutConflict,
  isFindShortcut,
  isReservedShortcut,
  isShortcutAllowedForAction,
  resolveShortcut,
  shortcutFromEvent,
  useShortcutStore,
  type ShortcutActionDefinition,
  type ShortcutActionId,
  type ShortcutCategory,
  type ShortcutChord,
} from "@uniwork/core/shortcuts";
import { isImeComposing } from "@uniwork/core/utils";
import { Button } from "@uniwork/ui/components/ui/button";
import { Input } from "@uniwork/ui/components/ui/input";
import { cn } from "@uniwork/ui/lib/utils";
import { ConfirmDialog } from "../../common/form-dialog";
import { ShortcutKeycaps } from "../../editor/shortcut-keycaps";
import { SettingsCard, SettingsRow, SettingsSection, SettingsTab } from "./settings-layout";

/**
 * Action ids are not i18n-safe (`ai.askUni` would nest under `ai`), so each
 * id maps explicitly to a flat key under `settings.shortcuts.actions`.
 */
export const SHORTCUT_ACTION_I18N_KEYS: Record<ShortcutActionId, string> = {
  "ai.askUni": "ai_ask_uni",
  openSearch: "open_search",
  createTask: "create_task",
  findInTask: "find_in_task",
  openThreadNav: "open_thread_nav",
  send: "send",
  goBack: "go_back",
  goForward: "go_forward",
  goInbox: "go_inbox",
  goTasks: "go_tasks",
  goMyTasks: "go_my_tasks",
  goProjects: "go_projects",
  goMeetings: "go_meetings",
  goChat: "go_chat",
  goPeople: "go_people",
  goSettings: "go_settings",
};

type CaptureError =
  | { kind: "conflict"; actionId: ShortcutActionId }
  | { kind: "reserved" }
  | { kind: "find" }
  | { kind: "send" }
  | { kind: "unsafe" }
  | null;

/** Why `isShortcutAllowedForAction` refused a chord that is not reserved. */
function refusalKind(actionId: ShortcutActionId, shortcut: ShortcutChord): "find" | "send" | "unsafe" {
  if (actionId === "send") return "send";
  // Cmd/Ctrl+F is refused for every action except findInTask.
  if (isFindShortcut(shortcut)) return "find";
  return "unsafe";
}

const GROUPS: readonly ShortcutCategory[] = ["general", "navigation"];

function useActionText() {
  const { t } = useTranslation(undefined, { keyPrefix: "settings.shortcuts" });
  return useMemo(
    () => ({
      label: (id: ShortcutActionId) => t(`actions.${SHORTCUT_ACTION_I18N_KEYS[id] ?? id}.label`),
      description: (id: ShortcutActionId) => t(`actions.${SHORTCUT_ACTION_I18N_KEYS[id] ?? id}.description`),
    }),
    [t],
  );
}

export function KeyboardShortcutsTab() {
  const { t } = useTranslation(undefined, { keyPrefix: "settings.shortcuts" });
  const text = useActionText();
  const [query, setQuery] = useState("");
  const [recording, setRecording] = useState<ShortcutActionId | null>(null);
  const [captureError, setCaptureError] = useState<CaptureError>(null);
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false);
  const overrides = useShortcutStore((state) => state.overrides);
  const setShortcut = useShortcutStore((state) => state.setShortcut);
  const resetShortcut = useShortcutStore((state) => state.resetShortcut);
  const resetAll = useShortcutStore((state) => state.resetAll);
  const hasOverrides = Object.keys(overrides).length > 0;

  const visibleActions = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    if (!needle) return SHORTCUT_ACTIONS;
    return SHORTCUT_ACTIONS.filter((action) =>
      `${text.label(action.id)} ${text.description(action.id)}`.toLocaleLowerCase().includes(needle),
    );
  }, [query, text]);

  const stopRecording = () => {
    setRecording(null);
    setCaptureError(null);
  };

  const capture = (actionId: ShortcutActionId, event: KeyboardEvent) => {
    // Keep the key away from GlobalShortcuts (document) and from window
    // listeners such as the sidebar primitive that ignore defaultPrevented.
    event.preventDefault();
    event.stopPropagation();
    if (event.repeat || isImeComposing(event)) return;
    if (event.key === "Escape") {
      stopRecording();
      return;
    }
    if (event.key === "Backspace" || event.key === "Delete") {
      setShortcut(actionId, null);
      stopRecording();
      return;
    }

    const shortcut = shortcutFromEvent(event.nativeEvent);
    if (!shortcut) return;
    if (isReservedShortcut(shortcut)) {
      setCaptureError({ kind: "reserved" });
      return;
    }
    if (!isShortcutAllowedForAction(actionId, shortcut)) {
      setCaptureError({ kind: refusalKind(actionId, shortcut) });
      return;
    }
    // A chord another action owns is refused, not taken over: the user picks
    // a different chord or frees the other action first.
    const conflict = findShortcutConflict(actionId, shortcut);
    if (conflict) {
      setCaptureError({ kind: "conflict", actionId: conflict });
      return;
    }

    setShortcut(actionId, shortcut);
    stopRecording();
  };

  return (
    <SettingsTab title={t("title")} description={t("description")}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative min-w-0 flex-1 sm:max-w-sm">
          <Search
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("search_placeholder")}
            aria-label={t("search_placeholder")}
            className="pl-8"
          />
        </div>
        <Button
          variant="outline"
          size="sm"
          aria-disabled={!hasOverrides}
          onClick={() => setResetConfirmOpen(true)}
        >
          <RotateCcw aria-hidden className="size-3.5" />
          {t("reset_all")}
        </Button>
      </div>

      {GROUPS.map((category) => {
        const actions = visibleActions.filter((action) => action.category === category);
        if (actions.length === 0) return null;
        return (
          <SettingsSection key={category} title={t(`categories.${category}`)}>
            <SettingsCard>
              {actions.map((action) => (
                <ShortcutRow
                  key={action.id}
                  action={action}
                  shortcut={resolveShortcut(overrides, action.id)}
                  customized={Object.prototype.hasOwnProperty.call(overrides, action.id)}
                  recording={recording === action.id}
                  error={recording === action.id ? captureError : null}
                  onStartRecording={() => {
                    setRecording(action.id);
                    setCaptureError(null);
                  }}
                  onCancelRecording={stopRecording}
                  onCapture={(event) => capture(action.id, event)}
                  onDisable={() => {
                    setShortcut(action.id, null);
                    setCaptureError(null);
                  }}
                  onReset={() => {
                    resetShortcut(action.id);
                    setCaptureError(null);
                  }}
                />
              ))}
            </SettingsCard>
          </SettingsSection>
        );
      })}

      {visibleActions.length === 0 ? (
        <div className="rounded-lg border border-dashed px-4 py-10 text-center text-body text-muted-foreground">
          {t("no_results")}
        </div>
      ) : null}

      <SettingsSection title={t("fixed.title")} description={t("fixed.description")}>
        <SettingsCard>
          <FixedShortcutRow label={t("fixed.toggle_sidebar")} shortcut={createShortcutChord("B", { primary: true })} />
          <FixedShortcutRow label={t("fixed.close_dialog")} shortcut={createShortcutChord("Escape")} />
        </SettingsCard>
      </SettingsSection>

      <ConfirmDialog
        open={resetConfirmOpen}
        onOpenChange={setResetConfirmOpen}
        title={t("reset_confirm.title")}
        description={t("reset_confirm.description")}
        confirmLabel={t("reset_confirm.confirm")}
        onConfirm={() => {
          resetAll();
          stopRecording();
          setResetConfirmOpen(false);
        }}
      />
    </SettingsTab>
  );
}

function ShortcutRow({
  action,
  shortcut,
  customized,
  recording,
  error,
  onStartRecording,
  onCancelRecording,
  onCapture,
  onDisable,
  onReset,
}: {
  action: ShortcutActionDefinition;
  shortcut: ShortcutChord | null;
  customized: boolean;
  recording: boolean;
  error: CaptureError;
  onStartRecording: () => void;
  onCancelRecording: () => void;
  onCapture: (event: KeyboardEvent) => void;
  onDisable: () => void;
  onReset: () => void;
}) {
  const { t } = useTranslation(undefined, { keyPrefix: "settings.shortcuts" });
  const text = useActionText();
  const label = text.label(action.id);
  let errorText: string | null = null;
  switch (error?.kind) {
    case "reserved":
      errorText = t("reserved_error");
      break;
    case "find":
      errorText = t("find_error");
      break;
    case "send":
      errorText = t("send_error");
      break;
    case "unsafe":
      errorText = t("unsafe_error");
      break;
    case "conflict":
      errorText = t("conflict_error", { action: text.label(error.actionId) });
      break;
    default:
      errorText = null;
  }

  return (
    <SettingsRow label={label} description={text.description(action.id)} align="start" size="select-wide">
      <div className="flex flex-col items-stretch gap-1.5 sm:items-end">
        <div className="flex items-center justify-end gap-1.5">
          <button
            type="button"
            onClick={onStartRecording}
            onKeyDown={recording ? onCapture : undefined}
            onBlur={onCancelRecording}
            className={cn(
              "inline-flex h-8 min-w-28 items-center justify-center rounded-md border bg-background px-2.5 font-mono text-caption font-medium shadow-xs transition-colors hover:bg-surface-hover pointer-coarse:min-h-11",
              recording && "border-brand bg-brand/5 text-brand ring-2 ring-brand/20",
              error && "border-destructive text-destructive ring-destructive/20",
            )}
            aria-label={t("record_aria", { action: label })}
            aria-pressed={recording}
          >
            {recording ? (
              <span className="inline-flex items-center gap-1.5 font-sans">
                <Keyboard aria-hidden className="size-3.5" />
                {t("recording")}
              </span>
            ) : shortcut ? (
              <ShortcutKeycaps shortcut={shortcut} decorative />
            ) : (
              <span className="font-sans font-normal text-muted-foreground">{t("unassigned")}</span>
            )}
          </button>
          {/* Reset exists only for a customised row. The placeholder keeps
              every row's recorder and clear button on the same vertical line. */}
          {customized ? (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={onReset}
              aria-label={t("reset_action", { action: label })}
              title={t("reset")}
            >
              <RotateCcw aria-hidden className="size-3.5" />
            </Button>
          ) : (
            <span aria-hidden className="size-7 shrink-0 pointer-coarse:size-11" />
          )}
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={onDisable}
            aria-disabled={shortcut === null}
            aria-label={t("disable_action", { action: label })}
            title={t("disable")}
          >
            <X aria-hidden className="size-3.5" />
          </Button>
        </div>
        {errorText ? (
          <span role="alert" className="max-w-72 text-right text-caption text-destructive">
            {errorText}
          </span>
        ) : recording ? (
          <span className="text-right text-micro text-muted-foreground">{t("record_hint")}</span>
        ) : null}
      </div>
    </SettingsRow>
  );
}

function FixedShortcutRow({ label, shortcut }: { label: string; shortcut: ShortcutChord }) {
  return (
    <SettingsRow label={label}>
      <ShortcutKeycaps shortcut={shortcut} size="md" className="justify-end" />
    </SettingsRow>
  );
}
