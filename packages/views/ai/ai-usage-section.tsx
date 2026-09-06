"use client";

import { useTranslation } from "react-i18next";
import { useAiUsage } from "@uniwork/core/ai";
import type { AiUsageRow } from "@uniwork/core/types";
import { Skeleton } from "@uniwork/ui/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@uniwork/ui/components/ui/table";
import { SettingsCard, SettingsSection } from "../settings/components/settings-layout";

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
  const d = points.map((p, i) => `${i === 0 ? "M" : "L"}${(i * step).toFixed(1)},${(h - 2 - (p.tokens / max) * (h - 4)).toFixed(1)}`).join(" ");
  return (
    <>
      <svg viewBox={`0 0 ${w} ${h}`} width={w} height={h} role="img" aria-label={label} className="text-foreground">
        <path d={d} fill="none" stroke="currentColor" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        {points.map((p, i) => (
          <circle key={p.day} cx={(i * step).toFixed(1)} cy={(h - 2 - (p.tokens / max) * (h - 4)).toFixed(1)} r={4} fill="transparent">
            <title>{`${p.day}: ${p.tokens.toLocaleString(locale)}`}</title>
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
                <td>{p.day}</td>
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

export function AiUsageSection({ workspaceId }: { workspaceId: string }) {
  const { t, i18n } = useTranslation(undefined, { keyPrefix: "settings.ai" });
  const locale = i18n.language;
  const to = new Date();
  const from = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate() - (WINDOW_DAYS - 1)));
  const usage = useAiUsage(workspaceId, isoDay(from), undefined);

  if (usage.isLoading) return <Skeleton className="h-48 w-full" />;
  if (usage.isError) {
    return (
      <p role="alert" className="text-body text-destructive">
        {t("error_title")}
      </p>
    );
  }
  const rows = usage.data?.rows ?? [];
  if (rows.length === 0) {
    return (
      <div role="status" className="rounded-lg border border-dashed border-border p-6 text-center">
        <p className="text-body font-medium">{t("empty_title")}</p>
        <p className="mt-1 text-caption text-muted-foreground">{t("empty_description")}</p>
      </div>
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
      <SettingsSection title={t("window", { days: WINDOW_DAYS })}>
        <SettingsCard>
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
        </SettingsCard>
      </SettingsSection>
      <SettingsSection title={t("by_capability")}>
        <Table>
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
      </SettingsSection>
    </div>
  );
}
