"use client";

import { useState } from "react";
import { Check, ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { MODULE_ICONS } from "@uniwork/views/layout/module-icons";
import { IconTile } from "@uniwork/ui/components/common/icon-tile";
import { Button } from "@uniwork/ui/components/ui/button";
import { Input } from "@uniwork/ui/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@uniwork/ui/components/ui/dialog";

export function ProductDemoHome({ onTask, onMeeting }: { onTask: (title: string) => void; onMeeting: (title: string, startsAt: string) => void }) {
  const { t, i18n } = useTranslation();
  const [creating, setCreating] = useState<"task" | "meeting" | null>(null);
  const [title, setTitle] = useState("");
  const [startsAt, setStartsAt] = useState("2026-10-16T14:00");
  return <div className="product-demo-home">
    <time dateTime="2026-10-16">{new Intl.DateTimeFormat(i18n.language.startsWith("vi") ? "vi-VN" : "en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).format(new Date("2026-10-16T08:00:00Z"))}</time>
    <h2>{t("home.greeting.morning", { name: "Đạt" })}</h2><p>{t("home.headline.clear")}</p>
    <section className="product-demo-start"><header><h3>{t("home.start.title")}</h3><p>{t("home.start.description")}</p></header>
      {(["task", "meeting"] as const).map(kind => <button type="button" key={kind} aria-haspopup="dialog" onClick={() => { setTitle(""); setCreating(kind); }}>
        <IconTile icon={kind === "task" ? MODULE_ICONS.tasks : MODULE_ICONS.meetings} tone={kind === "task" ? "green" : "violet"} />
        <span><strong>{t(`home.start.${kind === "task" ? "create_task" : "meeting"}`)}</strong><small>{t(`home.start.${kind === "task" ? "create_task_hint" : "meeting_hint"}`)}</small></span><ChevronRight aria-hidden />
      </button>)}
    </section>
    <Dialog open={creating !== null} onOpenChange={open => { if (!open) setCreating(null); }}>
      <DialogContent><DialogTitle>{t(creating === "meeting" ? "home.start.meeting" : "home.start.create_task")}</DialogTitle><DialogDescription>{t("landing.lovable.sample")}</DialogDescription>
        <form className="product-demo-create" onSubmit={event => { event.preventDefault(); if (!title.trim()) return; if (creating === "meeting") onMeeting(title.trim(), startsAt); else onTask(title.trim()); setCreating(null); }}>
          <label>{t("meetings.meetingTitle")}<Input autoFocus required maxLength={160} value={title} onChange={event => setTitle(event.target.value)} /></label>
          {creating === "meeting" && <label>{t("meetings.startsAt")}<Input type="datetime-local" required value={startsAt} onChange={event => setStartsAt(event.target.value)} /></label>}
          <div><Button type="button" variant="outline" onClick={() => setCreating(null)}>{t("common.cancel")}</Button><Button type="submit" disabled={!title.trim()}>{t("common.create")}</Button></div>
        </form>
      </DialogContent>
    </Dialog>
  </div>;
}

export function ProductDemoInbox({ onTask }: { onTask: () => void }) {
  const { t } = useTranslation();
  const [read, setRead] = useState(false);
  return <div className="product-demo-inbox">
    <div className="preview-project-heading"><h2>{t("nav.inbox")}</h2><Button variant="outline" size="sm" onClick={() => setRead(true)} disabled={read}><Check aria-hidden />{t("landing.workspace.markRead")}</Button></div>
    <p className="product-demo-muted" role="status">{t(read ? "home.inbox.empty_description" : "landing.studio.sharedWithTeam")}</p>
    {!read && ["design", "review"].map(key => <button className="product-demo-inbox-row" type="button" key={key} onClick={onTask}><IconTile icon={MODULE_ICONS.tasks} tone="green" /><span><strong>{t(`landing.studio.task_${key}`)}</strong><small>{t("landing.demo.openTask")}</small></span><ChevronRight aria-hidden /></button>)}
  </div>;
}
