"use client";

import { useTranslation } from "react-i18next";
import type { XlsxEditorHandle } from "../types";
import { XLSX_RULE_SETS_DROPPED } from "./rule-set-drops";

const MAX_LISTED = 10;

export interface RuleSetDropNoticeProps {
  errorCode: string | null | undefined;
  editor: Pick<XlsxEditorHandle, "droppedRuleSets"> | undefined;
}

/** X01 r2: tells the user which CF/DV rule sets the last save left out. The
 *  other edits stay pending; pressing Save again saves them. */
export function RuleSetDropNotice({ errorCode, editor }: RuleSetDropNoticeProps) {
  const { t } = useTranslation();
  if (errorCode !== XLSX_RULE_SETS_DROPPED) return null;
  const drops = editor?.droppedRuleSets?.() ?? [];
  const listed = drops.slice(0, MAX_LISTED);
  const hidden = drops.length - listed.length;
  return (
    <div className="border-b border-destructive/30 bg-destructive/10 px-3 py-1 text-caption text-destructive" role="alert" data-testid="xlsx-rule-set-dropped">
      <p>{t("office.xlsx.conditionalFormat.dropped.title")}</p>
      {listed.length > 0 ? (
        <ul>
          {listed.map((drop, index) => (
            <li key={`${drop.family}:${drop.sheet}:${index}`}>
              {t("office.xlsx.conditionalFormat.dropped.item", {
                family: t(drop.family === "dataValidations" ? "office.xlsx.conditionalFormat.dropped.familyDataValidations" : "office.xlsx.conditionalFormat.dropped.familyConditionalFormats"),
                sheet: drop.sheet,
                interpolation: { escapeValue: false },
              })}
            </li>
          ))}
        </ul>
      ) : null}
      {hidden > 0 ? <p>{t("office.xlsx.conditionalFormat.dropped.more", { count: hidden })}</p> : null}
      <p>{t("office.xlsx.conditionalFormat.dropped.saveAgain")}</p>
    </div>
  );
}
