"use client";
import { ArrowUpRight, Bell, CheckCheck, Columns3, Video } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";

export function TodayPreview({ tasks, onTask, onMeeting }: { tasks: readonly { key: string; state: "todo" | "in_progress" | "done"; person: string }[]; onTask: (key: string) => void; onMeeting: () => void }) {
  const { t } = useTranslation();
  const [read, setRead] = useState(false);
  const personalTasks = ["design", "brief"].flatMap(key => tasks.filter(task => task.key === key));
  const names: Record<string, string> = { HA: "Hoàng Anh", ML: "Minh Linh", TN: "Thanh Ngân", LT: "Linh Trần" };
  return <div className="today-preview">
    <div className="preview-project-heading"><div><h2>{t("landing.updates.today")}</h2><p>{t("landing.workspace.todayNote")}</p></div></div>
    <div className="today-summary">
      <button type="button" onClick={() => onTask("design")}><Columns3 aria-hidden /><strong>{tasks.filter(task => task.state !== "done").length}</strong><span>{t("landing.workspace.openTasks")}</span><ArrowUpRight aria-hidden /></button>
      <button type="button" onClick={onMeeting}><Video aria-hidden /><strong>1</strong><span>{t("landing.updates.upcoming")}</span><ArrowUpRight aria-hidden /></button>
    </div>
    <div className="today-work-grid"><div className="today-task-panel"><h3><Columns3 aria-hidden />{t("landing.reference.myTasks")}</h3>{personalTasks.map(task => <button type="button" key={task.key} onClick={() => onTask(task.key)}><span className="today-task-state">{task.state}</span><strong>{t(`landing.studio.task_${task.key}`)}</strong><small>{names[task.person] ?? task.person} · {task.key === "design" ? "UW-102" : "UW-101"}</small><ArrowUpRight aria-hidden /></button>)}</div>
    <div className="today-inbox">
      <div><h3><Bell aria-hidden />{t("landing.inbox.tab")}</h3><Button size="sm" variant="ghost" onClick={() => setRead(!read)}><CheckCheck aria-hidden />{t(read ? "landing.workspace.resetInbox" : "landing.workspace.markRead")}</Button></div>
      <p role="status">{t(read ? "landing.workspace.allRead" : "landing.explorer.unread")}</p>
      <ul>{[1, 2].map(number => <li key={number} data-read={read}><span className="today-unread" aria-hidden /><span>{t(`landing.explorer.notice${number}`)}<small>{t(`landing.explorer.noticeContext${number}`)}</small></span></li>)}</ul>
    </div></div>
    <div className="today-agenda"><h3>{t("landing.workspace.agenda")}</h3><button type="button" onClick={onMeeting}><span>09:30</span><Video aria-hidden /><span>{t("landing.meeting.roomTitle")}<small>{t("landing.workspace.openMeeting")}</small></span><ArrowUpRight aria-hidden /></button></div>
  </div>;
}
