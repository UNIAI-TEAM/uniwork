"use client";

// Conditional Formatting rule manager: lists the sheet's live rules (priority
// order), scoped to the selection or the sheet. Edit reopens the preset dialog
// prefilled, Move up / Move down reorder, Delete removes; each command runs
// through the toolbar's command port and the list is re-read afterwards.

import { useState } from "react";
import { ArrowDown, ArrowUp, Pencil, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@uniwork/ui/components/ui/dialog";
import { rangesLabel } from "../data-validation/rule-areas";
import { RuleScopeSwitch } from "../data-validation/rule-scope-switch";
import { runRuleCommand } from "../data-validation/run-rule-command";
import { useLiveRules } from "../data-validation/use-live-rules";
import type { XlsxLiveRule, XlsxToolbarCommands, XlsxToolbarTableRange } from "../toolbar/types";
import {
  deleteRuleParams,
  moveRuleParams,
  XLSX_CF_DELETE_COMMAND,
  XLSX_CF_MOVE_COMMAND,
  type XlsxCfRange,
} from "./cf-commands";
import { describeCfRule, editableCfRule } from "./cf-live-rule";
import { XlsxConditionalFormatDialog } from "./conditional-format-dialog";

interface XlsxCfRuleManagerProps {
  unitId: string;
  subUnitId: string;
  commands: XlsxToolbarCommands;
  selection: XlsxToolbarTableRange;
  onClose: () => void;
}

const BASE = "office.xlsx.conditionalFormat";
const ICON_BUTTON = "size-7 p-0";

function chipStyle(rule: XlsxLiveRule): { backgroundColor?: string; color?: string } | null {
  if (rule.rule.type !== "highlightCell") return null;
  const style = rule.rule.style as { bg?: { rgb?: unknown }; cl?: { rgb?: unknown } } | undefined;
  const bg = typeof style?.bg?.rgb === "string" ? style.bg.rgb : undefined;
  const cl = typeof style?.cl?.rgb === "string" ? style.cl.rgb : undefined;
  return { backgroundColor: bg, color: cl };
}

export function XlsxCfRuleManager({ unitId, subUnitId, commands, selection, onClose }: XlsxCfRuleManagerProps) {
  const { t } = useTranslation();
  const { scope, setScope, rules, refresh } = useLiveRules(commands, subUnitId, "conditionalFormats", selection);
  const [editing, setEditing] = useState<XlsxLiveRule | null>(null);
  const [refused, setRefused] = useState(false);
  const [pending, setPending] = useState(false);

  const describe = (rule: XlsxLiveRule): string => {
    const description = describeCfRule(rule.rule);
    return t(`${BASE}.manager.rules.${description.key}`, description.params);
  };

  const run = async (id: string, params: unknown) => {
    if (pending) return;
    setRefused(false);
    setPending(true);
    const accepted = await runRuleCommand(commands, id, params);
    setPending(false);
    if (accepted) refresh();
    else setRefused(true);
  };

  const editingState = editing ? editableCfRule(editing.rule) : null;

  return (
    <>
      <Dialog
        open
        onOpenChange={(open) => {
          if (!open) onClose();
        }}
      >
        <DialogContent className="max-w-2xl" data-testid="xlsx-cf-manager" closeLabel={t(`${BASE}.dialog.close`)}>
          <DialogHeader>
            <DialogTitle>{t(`${BASE}.manager.title`)}</DialogTitle>
            <DialogDescription>{t(`${BASE}.manager.description`)}</DialogDescription>
          </DialogHeader>
          <RuleScopeSwitch
            value={scope}
            onChange={setScope}
            label={t(`${BASE}.manager.scope`)}
            selectionLabel={t(`${BASE}.manager.scopeSelection`)}
            sheetLabel={t(`${BASE}.manager.scopeSheet`)}
          />
          {rules.length === 0 ? (
            <p className="text-caption text-muted-foreground" data-testid="xlsx-cf-manager-empty">
              {t(`${BASE}.manager.empty.${scope}`)}
            </p>
          ) : (
            <ul className="grid max-h-80 gap-1 overflow-y-auto" aria-label={t(`${BASE}.manager.list`)}>
              {rules.map((rule, index) => {
                const label = describe(rule);
                const chip = chipStyle(rule);
                // A linked Excel (x14) rule is kept verbatim at save while it
                // stays over its areas, so an in-place edit would be lost.
                const canEdit = !rule.linked && editableCfRule(rule.rule) !== null && rule.ranges.length > 0;
                const editReason = rule.linked ? t(`${BASE}.manager.editLinked`) : t(`${BASE}.manager.editUnsupported`);
                return (
                  <li
                    key={rule.id}
                    className="flex items-center gap-2 rounded-control border border-border px-2 py-1.5"
                    data-testid={`xlsx-cf-rule-${rule.id}`}
                  >
                    <div className="grid min-w-0 flex-1 gap-0.5">
                      <span className="truncate text-body font-medium">{label}</span>
                      <span className="truncate text-caption text-muted-foreground" data-testid="xlsx-cf-rule-areas">
                        {t(`${BASE}.manager.appliesTo`, { areas: rangesLabel(rule.ranges) })}
                      </span>
                    </div>
                    {chip ? (
                      // Previews the cell format stored in the file, not a theme colour.
                      <span
                        aria-hidden
                        data-testid="xlsx-cf-rule-chip"
                        className="shrink-0 rounded-sm border border-border px-2 py-0.5 text-caption text-foreground"
                        style={chip}
                      >
                        {t(`${BASE}.dialog.sample`)}
                      </span>
                    ) : null}
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      className={ICON_BUTTON}
                      aria-label={t(`${BASE}.manager.edit`, { rule: label })}
                      title={canEdit ? t(`${BASE}.manager.editTitle`) : editReason}
                      aria-disabled={!canEdit || pending || undefined}
                      data-testid="xlsx-cf-rule-edit"
                      onClick={() => {
                        if (canEdit && !pending) setEditing(rule);
                      }}
                    >
                      <Pencil aria-hidden />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      className={ICON_BUTTON}
                      aria-label={t(`${BASE}.manager.moveUp`, { rule: label })}
                      title={t(`${BASE}.manager.moveUpTitle`)}
                      aria-disabled={index === 0 || pending || undefined}
                      data-testid="xlsx-cf-rule-up"
                      onClick={() => {
                        const other = rules[index - 1];
                        if (other) void run(XLSX_CF_MOVE_COMMAND, moveRuleParams(unitId, subUnitId, rule.id, other.id, "before"));
                      }}
                    >
                      <ArrowUp aria-hidden />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      className={ICON_BUTTON}
                      aria-label={t(`${BASE}.manager.moveDown`, { rule: label })}
                      title={t(`${BASE}.manager.moveDownTitle`)}
                      aria-disabled={index === rules.length - 1 || pending || undefined}
                      data-testid="xlsx-cf-rule-down"
                      onClick={() => {
                        const other = rules[index + 1];
                        if (other) void run(XLSX_CF_MOVE_COMMAND, moveRuleParams(unitId, subUnitId, rule.id, other.id, "after"));
                      }}
                    >
                      <ArrowDown aria-hidden />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      className={ICON_BUTTON}
                      aria-label={t(`${BASE}.manager.delete`, { rule: label })}
                      title={t(`${BASE}.manager.deleteTitle`)}
                      aria-disabled={pending || undefined}
                      data-testid="xlsx-cf-rule-delete"
                      onClick={() => void run(XLSX_CF_DELETE_COMMAND, deleteRuleParams(unitId, subUnitId, rule.id))}
                    >
                      <Trash2 aria-hidden />
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
          {refused ? (
            <p role="alert" className="text-caption text-destructive" data-testid="xlsx-cf-manager-refused">
              {t(`${BASE}.errors.refused`)}
            </p>
          ) : null}
          <div className="flex justify-end">
            <Button type="button" variant="outline" size="sm" data-testid="xlsx-cf-manager-close" onClick={onClose}>
              {t(`${BASE}.manager.done`)}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      {editing && editingState ? (
        <XlsxConditionalFormatDialog
          preset={editingState.preset}
          unitId={unitId}
          subUnitId={subUnitId}
          range={editing.ranges[0] as XlsxCfRange}
          commands={commands}
          edit={{
            cfId: editing.id,
            ranges: editing.ranges,
            stopIfTrue: editing.stopIfTrue ?? false,
            initial: editingState,
          }}
          onClose={() => {
            setEditing(null);
            refresh();
          }}
        />
      ) : null}
    </>
  );
}
