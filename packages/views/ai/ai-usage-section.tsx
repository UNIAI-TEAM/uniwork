"use client";

import { AlertCircle, Sparkles } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAiUsage } from "@uniwork/core/ai";
import type { AiUsageRow } from "@uniwork/core/types";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@uniwork/ui/components/ui/table";
import { Notice } from "../common/notice";
import {
  SettingsCard,
  SettingsCardBody,
  SettingsEmpty,
  SettingsSection,
  SettingsSkeletonRows,
} from "../settings/components/settings-layout";

const WINDOW_DAYS = 30;

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Tokens per day for the window, zero-filled so the line has one point per day. */
function dailyTokens(rows: AiUsageRow[], from: Date, days: number): { day: string; tokens: number }[] {
  const byDay = new Map<string, number>();
  for (const r of rows) byDay.set(r.day, (byDay.get(r.day) ?? 0) + r.input_tokens + r.output_tokens);
  const out: { day: string; tokens: number }[] = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(from);
    d.setUTCDate(from.getUTCDate() + i);
    const key = isoDay(d);
    out.push({ day: key, tokens: byDay.get(key) ?? 0 });
  }
  return out;
}

/** A UTC calendar day ("2026-09-01") in the reader's locale ("1 thg 9", "Sep 1"). */
function dayFormatter(locale: string): (day: string) => string {
  const fmt = new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", timeZone: "UTC" });
  return (day) => {
    const date = new Date(`${day}T00:00:00Z`);
    return Number.isNaN(date.getTime()) ? day : fmt.format(date);
  };
}

/**
 * One series, so no legend: the title names it. A thin 2px stroke in the
 * text colour, a `<title>` per day for hover, and the table below is the
 * accessible view of the same numbers.
 */
function Sparkline({ points, label, locale }: { points: { day: string; tokens: number }[]; label: string; locale: string }) {
  const { t } = useTranslation(undefined, { keyPrefix: "settings.ai" });
  const w = 240;
  const h = 40;
  const max = Math.max(1, ...points.map((p) => p.tokens));
  const step = points.length > 1 ? w / (points.length - 1) : 0;
  const formatDay = dayFormatter(locale);
  const d = points.map((p, i) => `${i === 0 ? "M" : "L"}${(i * step).toFixed(1)},${(h - 2 - (p.tokens / max) * (h - 4)).toFixed(1)}`).join(" ");
  return (
    <>
      <svg viewBox={`0 0 ${w} ${h}`} width={w} height={h} role="img" aria-label={label} className="text-foreground">
        <path d={d} fill="none" stroke="currentColor" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        {points.map((p, i) => (
          <circle key={p.day} cx={(i * step).toFixed(1)} cy={(h - 2 - (p.tokens / max) * (h - 4)).toFixed(1)} r={4} fill="transparent">
            <title>{`${formatDay(p.day)}: ${p.tokens.toLocaleString(locale)}`}</title>
          </circle>
        ))}
      </svg>
      {/* The readable form of the same numbers: hover-only titles are not enough. */}
      <details className="mt-2 text-caption">
        <summary className="cursor-pointer text-muted-foreground hover:text-foreground">{t("tokens_by_day")}</summary>
        <table className="mt-2 w-full tabular-nums">
          <thead>
            <tr>
              <th scope="col" className="text-left font-medium">{t("columns.day")}</th>
              <th scope="col" className="text-right font-medium">{t("columns.tokens")}</th>
            </tr>
          </thead>
          <tbody>
            {points.filter((p) => p.tokens > 0).map((p) => (
              <tr key={p.day}>
                <td>
                  <time dateTime={p.day}>{formatDay(p.day)}</time>
                </td>
                <td className="text-right">{p.tokens.toLocaleString(locale)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </>
  );
}

function usd(micros: number, locale: string): string {
  return (micros / 1_000_000).toLocaleString(locale, { style: "currency", currency: "USD", maximumFractionDigits: 4 });
}

/**
 * The last 30 days of AI calls made from this workspace. `aiEnabled` is the
 * deployment's answer: while AI is off an empty history is not an invitation
 * to try Hỏi UNI, so the section says nothing rather than suggest it.
 */
export function AiUsageSection({ workspaceId, aiEnabled }: { workspaceId: string; aiEnabled: boolean }) {
  const { t, i18n } = useTranslation(undefined, { keyPrefix: "settings.ai" });
  const locale = i18n.language;
  const to = new Date();
  const from = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate() - (WINDOW_DAYS - 1)));
  const usage = useAiUsage(workspaceId, isoDay(from), undefined);
  const title = t("window", { days: WINDOW_DAYS });

  if (usage.isLoading) {
    return (
      <SettingsSection title={title}>
        <SettingsSkeletonRows rows={2} />
      </SettingsSection>
    );
  }
  if (usage.isError) {
    return (
      <SettingsSection title={title}>
        <Notice tone="destructive" icon={AlertCircle} layout="inline" live="assertive">
          {t("error_title")}
        </Notice>
      </SettingsSection>
    );
  }
  const rows = usage.data?.rows ?? [];
  if (rows.length === 0) {
    if (!aiEnabled) return null;
    return (
      <SettingsSection title={title}>
        <SettingsCard>
          <div role="status">
            <SettingsEmpty icon={<Sparkles aria-hidden />}>
              <span className="block font-medium text-foreground">{t("empty_title")}</span>
              <span className="block text-caption">{t("empty_description")}</span>
            </SettingsEmpty>
          </div>
        </SettingsCard>
      </SettingsSection>
    );
  }
  const totals = rows.reduce(
    (acc, r) => ({ calls: acc.calls + r.calls, input: acc.input + r.input_tokens, output: acc.output + r.output_tokens, cost: acc.cost + r.cost_micros }),
    { calls: 0, input: 0, output: 0, cost: 0 },
  );
  const grouped = new Map<string, AiUsageRow>();
  for (const r of rows) {
    const key = `${r.capability}|${r.actor_kind}`;
    const g = grouped.get(key);
    if (g) {
      grouped.set(key, { ...g, calls: g.calls + r.calls, input_tokens: g.input_tokens + r.input_tokens, output_tokens: g.output_tokens + r.output_tokens, cost_micros: g.cost_micros + r.cost_micros });
    } else {
      grouped.set(key, { ...r });
    }
  }
  const points = dailyTokens(rows, from, WINDOW_DAYS);

  return (
    <div className="space-y-6">
      <SettingsSection title={title}>
        <SettingsCard>
          <SettingsCardBody>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-body sm:grid-cols-4">
              {(
                [
                  ["calls", totals.calls.toLocaleString(locale)],
                  ["input", totals.input.toLocaleString(locale)],
                  ["output", totals.output.toLocaleString(locale)],
                  ["cost", usd(totals.cost, locale)],
                ] as const
              ).map(([k, v]) => (
                <div key={k}>
                  <dt className="text-caption text-muted-foreground">{t(`totals.${k}`)}</dt>
                  <dd className="tabular-nums">{v}</dd>
                </div>
              ))}
            </dl>
            <div className="mt-4">
              <Sparkline points={points} label={t("sparkline_label")} locale={locale} />
            </div>
          </SettingsCardBody>
        </SettingsCard>
      </SettingsSection>
      <SettingsSection title={t("by_capability")}>
        <SettingsCard>
          {/* Cells keep the card's 16px inset so the table lines up with the rows above. */}
          <Table className="[&_td:first-child]:pl-4 [&_td:last-child]:pr-4 [&_th:first-child]:pl-4 [&_th:last-child]:pr-4">
            <TableHeader>
              <TableRow>
                <TableHead>{t("columns.capability")}</TableHead>
                <TableHead>{t("columns.actor")}</TableHead>
                <TableHead className="text-right">{t("columns.calls")}</TableHead>
                <TableHead className="text-right">{t("columns.tokens")}</TableHead>
                <TableHead className="text-right">{t("columns.cost")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {[...grouped.values()].map((r) => (
                <TableRow key={`${r.capability}|${r.actor_kind}`}>
                  <TableCell>{t(`capability.${r.capability}`, { defaultValue: r.capability })}</TableCell>
                  <TableCell>{t(`actor.${r.actor_kind}`, { defaultValue: r.actor_kind })}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.calls.toLocaleString(locale)}</TableCell>
                  <TableCell className="text-right tabular-nums">{(r.input_tokens + r.output_tokens).toLocaleString(locale)}</TableCell>
                  <TableCell className="text-right tabular-nums">{usd(r.cost_micros, locale)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </SettingsCard>
      </SettingsSection>
    </div>
  );
}
