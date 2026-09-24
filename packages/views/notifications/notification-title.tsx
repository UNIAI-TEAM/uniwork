"use client";

import { Fragment, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { Notification, TaskStatus } from "@uniwork/core/types";
import { tintClass } from "@uniwork/ui/components/common/icon-tile";
import { cn } from "@uniwork/ui/lib/utils";
import { STATUS_CONFIG } from "../tasks/modes/status-config";

/** Brackets each param in the rendered sentence so it can be found again. */
const MARK = "⁣";

type Part = { text: string } | { param: string; value: string };

/**
 * Splits the sentence `t(title_key, params)` renders into its literal text
 * and the params it placed, in the order the locale put them. The sentence
 * itself stays owned by the locale file (and pinned to the server's
 * titles.go), so word order in Vietnamese and English never has to agree.
 */
export function titleParts(render: (params: Record<string, string>) => string, params: Record<string, string>): Part[] {
  const marked = Object.fromEntries(Object.keys(params).map((k) => [k, `${MARK}${k}${MARK}`]));
  const pieces = render(marked).split(MARK);
  return pieces
    .map((piece, i): Part | null => {
      if (i % 2 === 0) return piece ? { text: piece } : null;
      return piece in params ? { param: piece, value: params[piece] ?? "" } : { text: piece };
    })
    .filter((p): p is Part => p !== null);
}

/**
 * The row's sentence with the parts a scan looks for picked out: who did it
 * (and, for an agent, that it was one — ADR 0007: the label comes from the
 * actor's kind, never from the name), what it happened to, and the state it
 * reached. A status arrives as its catalogue key and a role as its enum; both
 * are shown in the reader's language, the status on its own tint so "moved
 * to In review" reads at a glance.
 */
export function NotificationTitle({ notification: n, unread }: { notification: Notification; unread: boolean }) {
  const { t } = useTranslation();
  const parts = titleParts((params) => t(n.title_key, { ...params, defaultValue: n.kind }), n.params);
  const isAgent = n.actor_kind === "agent";

  const render = (param: string, value: string): ReactNode => {
    switch (param) {
      case "actor":
        return (
          <>
            <span className={cn("text-foreground", unread ? "font-semibold" : "font-medium")}>{value}</span>
            {isAgent ? " " : null}
            {isAgent ? (
              <span className="inline-flex translate-y-[-1px] items-center rounded-[5px] bg-brand-subtle px-1 text-micro leading-4 font-semibold text-brand-subtle-foreground align-middle">
                {t("people.agent_badge")}
              </span>
            ) : null}
          </>
        );
      case "task":
      case "meeting":
      case "workspace":
        return <span className="font-medium text-foreground">{value}</span>;
      case "status": {
        const cfg = STATUS_CONFIG[value as TaskStatus];
        return (
          <span
            className={cn(
              "inline-flex translate-y-[-1px] items-center rounded-[5px] px-1.5 text-caption leading-5 font-medium align-middle",
              cfg ? tintClass[cfg.tone] : "bg-muted text-foreground",
            )}
          >
            {t(`tasks.status_${value}`, { defaultValue: value })}
          </span>
        );
      }
      case "role":
        return <span className="font-medium text-foreground">{t(`people.role_${value}`, { defaultValue: value })}</span>;
      default:
        return value;
    }
  };

  return (
    <>
      {parts.map((p, i) => (
        <Fragment key={i}>{"text" in p ? p.text : render(p.param, p.value)}</Fragment>
      ))}
    </>
  );
}
