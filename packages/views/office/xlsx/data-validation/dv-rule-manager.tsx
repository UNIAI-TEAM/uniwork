"use client";

// Data Validation rule manager: lists the sheet's live rules, scoped to the
// selection or the sheet. Edit reopens the validation dialog prefilled, Delete
// removes the rule. On a sheet with Excel extended (x14) validation the list
// is read-only: the reason shows and both actions are aria-disabled.

import { useState } from "react";
import { Pencil, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@uniwork/ui/components/ui/dialog";
import type { XlsxLiveRule, XlsxToolbarCommands, XlsxToolbarTableRange } from "../toolbar/types";
import { XlsxDataValidationDialog } from "./data-validation-dialog";
import { describeDvRule, editableDvForm } from "./dv-live-rule";
import { removeDvParams, XLSX_DV_REMOVE_COMMAND, type XlsxDvRange } from "./dv-commands";
import { rangesLabel } from "./rule-areas";
import { RuleScopeSwitch } from "./rule-scope-switch";
import { runRuleCommand } from "./run-rule-command";
import { useLiveRules } from "./use-live-rules";

interface XlsxDvRuleManagerProps {
  unitId: string;
  subUnitId: string;
  commands: XlsxToolbarCommands;
  selection: XlsxToolbarTableRange;
  /** The sheet holds Excel extended (x14) validation the save cannot rewrite. */
  x14?: boolean;
  onClose: () => void;
}

const BASE = "office.xlsx.dataValidation";
const ICON_BUTTON = "size-7 p-0";

export function XlsxDvRuleManager({ unitId, subUnitId, commands, selection, x14 = false, onClose }: XlsxDvRuleManagerProps) {
  const { t } = useTranslation();
  const { scope, setScope, rules, refresh } = useLiveRules(commands, subUnitId, "dataValidations", selection);
  const [editing, setEditing] = useState<XlsxLiveRule | null>(null);
  const [refused, setRefused] = useState(false);
  const [pending, setPending] = useState(false);

  const describe = (rule: XlsxLiveRule): string => {
    const description = describeDvRule(rule.rule);
    const operator = description.operatorKey ? t(`${BASE}.operators.${description.operatorKey}`) : "";
    const type = description.typeKey ? t(`${BASE}.types.${description.typeKey}`) : "";
    return t(`${BASE}.manager.rules.${description.key}`, { ...description.params, type: type || description.params.type, operator });
  };

  const remove = async (rule: XlsxLiveRule) => {
    if (x14 || pending) return;
    setRefused(false);
    setPending(true);
    const accepted = await runRuleCommand(commands, XLSX_DV_REMOVE_COMMAND, removeDvParams(unitId, subUnitId, rule.id));
    setPending(false);
    if (accepted) refresh();
    else setRefused(true);
  };

  const editingForm = editing ? editableDvForm(editing.rule) : null;

  return (
    <>
      <Dialog
        open
        onOpenChange={(open) => {
          if (!open) onClose();
        }}
      >
        <DialogContent className="max-w-2xl" data-testid="xlsx-dv-manager" closeLabel={t(`${BASE}.dialog.close`)}>
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
          {x14 ? (
            <p className="text-caption text-muted-foreground" data-testid="xlsx-dv-manager-x14">
              {t(`${BASE}.errors.x14Sheet`)}
            </p>
          ) : null}
          {rules.length === 0 ? (
            <p className="text-caption text-muted-foreground" data-testid="xlsx-dv-manager-empty">
              {t(`${BASE}.manager.empty.${scope}`)}
            </p>
          ) : (
            <ul className="grid max-h-80 gap-1 overflow-y-auto" aria-label={t(`${BASE}.manager.list`)}>
              {rules.map((rule) => {
                const label = describe(rule);
                const style = describeDvRule(rule.rule).errorStyle;
                const canEdit = !x14 && editableDvForm(rule.rule) !== null && rule.ranges.length > 0;
                const editTitle = x14 ? t(`${BASE}.errors.x14Sheet`) : t(`${BASE}.manager.editUnsupported`);
                return (
                  <li
                    key={rule.id}
                    className="flex items-center gap-2 rounded-control border border-border px-2 py-1.5"
                    data-testid={`xlsx-dv-rule-${rule.id}`}
                  >
                    <div className="grid min-w-0 flex-1 gap-0.5">
                      <span className="truncate text-body font-medium">{label}</span>
                      <span className="truncate text-caption text-muted-foreground" data-testid="xlsx-dv-rule-areas">
                        {t(`${BASE}.manager.appliesTo`, { areas: rangesLabel(rule.ranges) })}
                      </span>
                      <span className="truncate text-caption text-muted-foreground" data-testid="xlsx-dv-rule-style">
                        {t(`${BASE}.manager.errorStyle`, { style: t(`${BASE}.errorStyles.${style}`) })}
                      </span>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      className={ICON_BUTTON}
                      aria-label={t(`${BASE}.manager.edit`, { rule: label })}
                      title={canEdit ? t(`${BASE}.manager.editTitle`) : editTitle}
                      aria-disabled={!canEdit || pending || undefined}
                      data-testid="xlsx-dv-rule-edit"
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
                      aria-label={t(`${BASE}.manager.delete`, { rule: label })}
                      title={x14 ? t(`${BASE}.errors.x14Sheet`) : t(`${BASE}.manager.deleteTitle`)}
                      aria-disabled={x14 || pending || undefined}
                      data-testid="xlsx-dv-rule-delete"
                      onClick={() => void remove(rule)}
                    >
                      <Trash2 aria-hidden />
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
          {refused ? (
            <p role="alert" className="text-caption text-destructive" data-testid="xlsx-dv-manager-refused">
              {t(`${BASE}.errors.refused`)}
            </p>
          ) : null}
          <div className="flex justify-end">
            <Button type="button" variant="outline" size="sm" data-testid="xlsx-dv-manager-close" onClick={onClose}>
              {t(`${BASE}.manager.done`)}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      {editing && editingForm ? (
        <XlsxDataValidationDialog
          commands={commands}
          unitId={unitId}
          subUnitId={subUnitId}
          range={editing.ranges[0] as XlsxDvRange}
          edit={{ ruleId: editing.id, ranges: editing.ranges, form: editingForm }}
          onClose={() => {
            setEditing(null);
            refresh();
          }}
        />
      ) : null}
    </>
  );
}
