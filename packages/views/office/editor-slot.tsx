"use client";

import { lazy, Suspense, useMemo, type ComponentType, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type {
  EditorHandle,
  OfficeCapabilityEntry,
  OfficeCapabilityStatus,
  OfficeHost,
} from "@uniwork/core/office";
import { Alert, AlertDescription, AlertTitle } from "@uniwork/ui/components/ui/alert";
import { Button } from "@uniwork/ui/components/ui/button";
import { Skeleton } from "@uniwork/ui/components/ui/skeleton";
import { cn } from "@uniwork/ui/lib/utils";

/** The state returned by an editor host while a document is being opened. */
export type EditorOpenState = "loading" | "ready" | "error" | "password-cancel" | "unsupported";
export type OfficeFormat = EditorHandle["format"];

export interface OfficeEditorRendererProps<TSnapshot = unknown> {
  format: OfficeFormat;
  host: OfficeHost;
  editorHandle: EditorHandle<TSnapshot> | null;
}

export type OfficeEditorComponent<TSnapshot = unknown> = ComponentType<OfficeEditorRendererProps<TSnapshot>>;

/**
 * Format lanes provide this loader when their editor is ready. Keeping the
 * loader at the view seam makes each format a separate chunk and leaves the
 * shell usable while a format is still pending.
 */
export type OfficeEditorLoader<TSnapshot = unknown> = (
  format: OfficeFormat,
) => Promise<{ default: OfficeEditorComponent<TSnapshot> } | OfficeEditorComponent<TSnapshot>>;

export interface EditorSlotProps<TSnapshot = unknown> {
  format: OfficeFormat;
  host: OfficeHost;
  editorHandle?: EditorHandle<TSnapshot> | null;
  /** A capability entry is preferred; a status keeps the slot easy to mount from a host. */
  capability: OfficeCapabilityEntry | OfficeCapabilityStatus;
  openState?: EditorOpenState;
  openError?: ReactNode;
  onRetry?: () => void;
  loadEditor?: OfficeEditorLoader<TSnapshot>;
  className?: string;
}

function capabilityStatus(capability: EditorSlotProps["capability"]): OfficeCapabilityStatus {
  return typeof capability === "string" ? capability : capability.status;
}

function capabilityReason(capability: EditorSlotProps["capability"]): string | null {
  return typeof capability === "string" ? null : capability.reason ?? null;
}

function CapabilityMessage({
  status,
  reason,
}: {
  status: OfficeCapabilityStatus;
  reason: string | null;
}) {
  const { t } = useTranslation(undefined, { keyPrefix: "office.editor" });
  const key = status === "unknown" ? "capability_unknown" : status === "unavailable" ? "capability_unavailable" : "capability_readonly";
  return (
    <Alert data-testid={`office-capability-${status}`} variant={status === "unavailable" ? "destructive" : "default"}>
      <AlertTitle>{t(key)}</AlertTitle>
      <AlertDescription>
        {reason ?? t(status === "readonly" ? "read_only_hint" : "capability_hint")}
      </AlertDescription>
    </Alert>
  );
}

function OpenMessage({
  state,
  openError,
  onRetry,
}: Pick<EditorSlotProps, "openError" | "onRetry"> & { state: "error" | "password-cancel" | "unsupported" }) {
  const { t } = useTranslation(undefined, { keyPrefix: "office.editor" });
  const title = state === "password-cancel"
    ? t("password_cancelled")
    : state === "unsupported"
      ? t("mobile_unsupported")
      : t("open_error");
  const description = openError ?? t(state === "password-cancel" ? "password_cancelled_hint" : "open_error_hint");
  return (
    <Alert data-testid={`office-open-${state}`} variant="destructive" tabIndex={-1}>
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription>{description}</AlertDescription>
      {onRetry && state === "error" ? (
        <Button className="mt-2" size="sm" variant="outline" onClick={onRetry}>
          {t("retry")}
        </Button>
      ) : null}
    </Alert>
  );
}

function PendingEditorMessage({ format }: { format: OfficeFormat }) {
  const { t } = useTranslation(undefined, { keyPrefix: "office.editor" });
  return (
    <Alert data-testid="office-editor-pending">
      <AlertTitle>{t("editor_pending_title")}</AlertTitle>
      <AlertDescription>{t("editor_pending", { format })}</AlertDescription>
    </Alert>
  );
}

/** Shared opening boundary. It deliberately never renders an empty editor. */
export function EditorSlot<TSnapshot>({
  format,
  host,
  editorHandle = null,
  capability,
  openState = "loading",
  openError,
  onRetry,
  loadEditor,
  className,
}: EditorSlotProps<TSnapshot>) {
  const { t } = useTranslation(undefined, { keyPrefix: "office.editor" });
  const status = capabilityStatus(capability);
  const reason = capabilityReason(capability);
  const lazyEditor = useMemo(() => {
    if (!loadEditor || status !== "available" || openState !== "ready") return null;
    return lazy(async () => {
      const loaded = await loadEditor(format);
      return "default" in loaded ? loaded : { default: loaded };
    });
  }, [format, loadEditor, openState, status]);

  let content: ReactNode;
  if (status !== "available") {
    content = <CapabilityMessage status={status} reason={reason} />;
  } else if (openState === "error" || openState === "password-cancel" || openState === "unsupported") {
    content = <OpenMessage state={openState} openError={openError} onRetry={onRetry} />;
  } else if (openState === "loading") {
    content = (
      <div className="space-y-3" role="status" aria-live="polite" data-testid="office-editor-loading">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-[min(55vh,32rem)] min-h-48 w-full" />
        <span className="sr-only">{t("loading")}</span>
      </div>
    );
  } else if (!lazyEditor) {
    content = <PendingEditorMessage format={format} />;
  } else {
    const Editor = lazyEditor;
    content = (
      <Suspense
        fallback={
          <div className="space-y-3" role="status" aria-live="polite" data-testid="office-editor-loading">
            <Skeleton className="h-[min(55vh,32rem)] min-h-48 w-full" />
            <span className="sr-only">{t("loading")}</span>
          </div>
        }
      >
        <Editor format={format} host={host} editorHandle={editorHandle} />
      </Suspense>
    );
  }

  return (
    <section
      className={cn("flex min-h-48 min-w-0 flex-1 flex-col overflow-auto rounded-lg border border-border bg-background p-3", className)}
      data-office-editor-slot
      data-format={format}
      data-open-state={openState}
      aria-label={t("canvas_label", { format })}
    >
      {content}
    </section>
  );
}
