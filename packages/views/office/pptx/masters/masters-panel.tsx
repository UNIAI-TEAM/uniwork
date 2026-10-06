"use client";

/**
 * Slide master / layout view panel (B6ui, UNI-927; genoffice View > Slide
 * Master). Presentational and command-emitting: a parts listbox (master first,
 * then its layouts), an element listbox for the active part and an inspector
 * for the selected element. The host owns the data, the selection and the
 * engine: every change leaves through `onEdit` as one `MasterPanelEdit`.
 *
 * States: loading, unbound (no `onEdit` - controls disabled, never a faked
 * capability), empty parts / elements, ready, pending (an edit is in flight).
 */
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { X } from "lucide-react";
import { Badge } from "@uniwork/ui/components/ui/badge";
import { Button } from "@uniwork/ui/components/ui/button";
import { Skeleton } from "@uniwork/ui/components/ui/skeleton";
import { cn } from "@uniwork/ui/lib/utils";
import { MastersInspector } from "./masters-inspector";
import {
  groupMasterParts,
  type MasterPanelEdit,
  type MasterPanelProps,
  type MasterPartView,
} from "./masters-model";
import { MastersPartTools } from "./masters-part-tools";
import { MasterSelectList, type MasterSelectItem } from "./masters-select-list";
import { MastersTextStyle } from "./masters-text-style";

export function MastersPanel({
  parts,
  activePart,
  onSelectPart,
  elements,
  selectedElementId,
  onSelectElement,
  onEdit,
  onClose,
  status = "ready",
  pending = false,
  className,
}: MasterPanelProps) {
  const { t } = useTranslation(undefined, { keyPrefix: "office.pptx" });

  const partItems = useMemo<MasterSelectItem[]>(() => {
    const item = (part: MasterPartView, indent: boolean): MasterSelectItem => ({
      key: part.partPath,
      indent,
      content: (
        <>
          <Badge variant={part.kind === "master" ? "default" : "secondary"}>
            {part.kind === "master" ? t("masters.kind_master") : t("masters.kind_layout")}
          </Badge>
          <span className="min-w-0 flex-1 truncate">{part.name}</span>
        </>
      ),
    });
    return groupMasterParts(parts).flatMap((group) => [
      ...(group.master ? [item(group.master, false)] : []),
      ...group.layouts.map((layout) => item(layout, group.master !== null)),
    ]);
  }, [parts, t]);

  const elementItems = useMemo<MasterSelectItem[]>(
    () =>
      elements.map((element) => ({
        key: element.id,
        content: (
          <>
            <span className="min-w-0 flex-1 truncate">{element.label}</span>
            <Badge variant="outline">{element.placeholder ?? element.type}</Badge>
          </>
        ),
      })),
    [elements],
  );

  const bound = typeof onEdit === "function";
  const blocked = pending || !bound;
  const selected = elements.find((element) => element.id === selectedElementId) ?? null;
  const active = parts.find((part) => part.partPath === activePart) ?? null;

  const emit = (edit: MasterPanelEdit) => {
    if (!onEdit || pending) return;
    // The host reports a refused edit; a rejection must not escape as unhandled.
    void Promise.resolve(onEdit(edit)).catch(() => undefined);
  };

  const closeButton = onClose ? (
    <Button
      type="button"
      size="sm"
      variant="outline"
      data-pptx-masters-close
      onClick={onClose}
    >
      <X aria-hidden="true" />
      {t("masters.close")}
    </Button>
  ) : null;

  if (status === "loading") {
    return (
      <div
        role="status"
        aria-busy="true"
        aria-label={t("masters.loading")}
        data-pptx-masters-panel
        data-state="loading"
        className={cn("flex flex-col gap-3 p-3", className)}
      >
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-4 w-20" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }

  const state = status === "unbound" || !bound ? "unbound" : pending ? "pending" : "ready";

  return (
    <section
      aria-label={t("masters.title")}
      aria-busy={pending || undefined}
      data-pptx-masters-panel
      data-state={state}
      className={cn("flex min-h-0 flex-col gap-3 overflow-y-auto p-3", className)}
    >
      <header className="flex items-center justify-between gap-2">
        <h2 className="text-body font-medium text-foreground">{t("masters.title")}</h2>
        {closeButton}
      </header>

      {state === "unbound" ? (
        <p className="text-caption text-muted-foreground" data-testid="pptx-masters-unbound">
          {t("masters.unbound")}
        </p>
      ) : null}
      {pending ? (
        <p role="status" className="text-caption text-muted-foreground" data-testid="pptx-masters-busy">
          {t("masters.busy")}
        </p>
      ) : null}

      {parts.length === 0 ? (
        <p className="text-caption text-muted-foreground" data-testid="pptx-masters-parts-empty">
          {t("masters.parts_empty")}
        </p>
      ) : (
        <MasterSelectList
          label={t("masters.parts_label")}
          items={partItems}
          selectedKey={activePart}
          onSelect={onSelectPart}
          disabled={pending}
          testId="pptx-masters-parts"
        />
      )}

      {active ? <MastersPartTools key={active.partPath + "|" + active.name} part={active} disabled={blocked} onEdit={emit} /> : null}

      {parts.length === 0 ? null : activePart === null ? (
        <p className="text-caption text-muted-foreground" data-testid="pptx-masters-no-part">
          {t("masters.no_part")}
        </p>
      ) : elements.length === 0 ? (
        <p className="text-caption text-muted-foreground" data-testid="pptx-masters-elements-empty">
          {t("masters.elements_empty")}
        </p>
      ) : (
        <MasterSelectList
          label={t("masters.elements_label")}
          items={elementItems}
          selectedKey={selectedElementId}
          onSelect={onSelectElement}
          onClear={() => onSelectElement(null)}
          disabled={pending}
          testId="pptx-masters-elements"
        />
      )}

      {activePart !== null && elements.length > 0 ? (
        selected ? (
          <MastersInspector
            key={[
              activePart,
              selected.id,
              selected.box.x,
              selected.box.y,
              selected.box.w,
              selected.box.h,
              selected.fill ?? "",
              selected.text ?? "",
            ].join("|")}
            part={activePart}
            element={selected}
            disabled={blocked}
            onEdit={emit}
          />
        ) : (
          <p className="text-caption text-muted-foreground" data-testid="pptx-masters-no-element">
            {t("masters.no_element")}
          </p>
        )
      ) : null}

      {activePart !== null && selected?.placeholder ? (
        <MastersTextStyle key={activePart + "|" + selected.id} part={activePart} placeholder={selected.placeholder} idx={selected.idx} disabled={blocked} onEdit={emit} />
      ) : null}
    </section>
  );
}
