"use client";

import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Check, ChevronDown, Columns3, Ellipsis, Funnel, Layers, List, MessageSquare, Plus, Search, SlidersHorizontal, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { TaskBoardCardContent } from "@uniwork/views/tasks/modes/board-card-content";
import { StatusHeading, StatusIcon } from "@uniwork/views/tasks/modes/status-pill";
import { statusColumnBg } from "@uniwork/views/tasks/modes/status-config";
import { Button } from "@uniwork/ui/components/ui/button";
import { Input } from "@uniwork/ui/components/ui/input";
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@uniwork/ui/components/ui/dropdown-menu";
import { DEMO_CARD_PROPERTIES, DEMO_PEOPLE, DEMO_TASK_STATUSES, demoTaskRecord, type DemoTask, type DemoTaskStatus } from "./product-task-data";

/** Production card content and status colours, shared by the film and the interactive board. */
export function ProductTaskBoard({ tasks, query = "", onQuery, selected = "design", onSelect, onStatus, onChat, step, toolbarLeading, open, onOpenChange }: {
  tasks: DemoTask[]; query?: string; onQuery?: (query: string) => void; selected?: string;
  onSelect?: (key: string) => void; onStatus?: (key: string, status: DemoTaskStatus) => void; onChat?: () => void; step?: number;
  toolbarLeading?: ReactNode;
  open?: boolean; onOpenChange?: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const [opened, setOpened] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [view, setView] = useState("board");
  const [properties, setProperties] = useState(DEMO_CARD_PROPERTIES);
  const viewport = useRef<HTMLDivElement>(null);
  const automatic = step !== undefined;
  const current = tasks.find(task => task.key === selected) ?? tasks[0]!;
  const detailOpen = automatic ? step >= 1 && step <= 3 : open ?? opened;
  const changeOpen = (value: boolean) => { setOpened(value); onOpenChange?.(value); };
  const title = (task: DemoTask) => task.title ?? t(`landing.productDemo.board.tasks.${task.key}`);
  const visible = tasks.filter(task => title(task).toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  useLayoutEffect(() => {
    const node = viewport.current;
    if (!node) return;
    const align = () => {
      if (step === 0 || step === undefined) node.scrollLeft = node.clientWidth < 600 ? 592 : 0;
      if (step === 6) {
        const card = node.querySelector<HTMLElement>('[data-demo-item="design"]');
        if (card) node.scrollLeft += card.getBoundingClientRect().left - node.getBoundingClientRect().left - node.clientWidth * .4;
      }
    };
    if (node.clientWidth) { align(); return; }
    // The interactive board stays mounted behind the film; align when it becomes visible.
    const observer = new ResizeObserver(() => { if (node.clientWidth) { align(); observer.disconnect(); } });
    observer.observe(node);
    return () => observer.disconnect();
  }, [step]);
  const statusMenu = (task: DemoTask) => <DropdownMenu><DropdownMenuTrigger render={<Button variant="ghost" size="icon" className="product-task-card-menu" aria-label={t("tasks.surface.column_menu")} />}><Ellipsis aria-hidden /></DropdownMenuTrigger><DropdownMenuContent align="end">{DEMO_TASK_STATUSES.map(status => <DropdownMenuItem key={status} onClick={() => onStatus?.(task.key, status)}><StatusIcon status={status} />{t(`tasks.status_${status}`)}{task.state === status && <Check aria-hidden />}</DropdownMenuItem>)}</DropdownMenuContent></DropdownMenu>;
  const card = (task: DemoTask) => <div className="product-task-card" key={task.key} data-demo-item={task.key} data-demo-target={task.key === "design" ? "task-row" : undefined} data-demo-result={automatic && task.key === "design" && step === 6 ? "task-moved" : undefined}>
    <button type="button" className="product-task-open" data-demo-task={task.key} onClick={() => { onSelect?.(task.key); changeOpen(true); }}>
      <TaskBoardCardContent task={demoTaskRecord(task, title(task))} meta={{ projectName: t("landing.studio.launchProject") }} cardProperties={properties} reserveActionSpace={!automatic} />
    </button>
    {automatic ? task.key === "design" && <span className="product-task-card-menu" data-demo-target="task-status" data-show={step >= 4}><Ellipsis aria-hidden /></span> : statusMenu(task)}
    {automatic && task.key === "design" && step === 5 && <div className="product-task-status-menu"><small>{t("tasks.status")}</small>{DEMO_TASK_STATUSES.map(status => <span key={status} data-demo-target={status === "done" ? "task-done" : undefined} data-selected={status === "done"}><StatusIcon status={status} />{t(`tasks.status_${status}`)}{status === task.state && <Check />}</span>)}</div>}
  </div>;
  return <div className="product-task-board" data-view={view}>
    <div className="product-task-toolbar">{toolbarLeading ?? <span className="product-task-all">{t("landing.productDemo.board.all")}</span>}<div>
      <span className="product-task-agent"><Layers aria-hidden />Agent</span>
      <Button variant="ghost" size="sm" aria-expanded={filterOpen} onClick={() => setFilterOpen(value => !value)}><Funnel aria-hidden />{t("landing.productDemo.board.filter")}</Button>
      <DropdownMenu><DropdownMenuTrigger render={<Button variant="ghost" size="sm" />}><SlidersHorizontal aria-hidden />{t("landing.productDemo.board.display")}</DropdownMenuTrigger><DropdownMenuContent align="end">
        {(["assignee", "project"] as const).map(key => <DropdownMenuCheckboxItem key={key} checked={properties[key]} onCheckedChange={checked => setProperties(current => ({ ...current, [key]: checked }))}>{t(key === "assignee" ? "landing.playback.assignee" : "landing.playback.project")}</DropdownMenuCheckboxItem>)}
      </DropdownMenuContent></DropdownMenu>
      <DropdownMenu><DropdownMenuTrigger render={<Button variant="ghost" size="sm" />} >{view === "board" ? <Columns3 aria-hidden /> : <List aria-hidden />}{t(`landing.studio.${view}`)}<ChevronDown aria-hidden /></DropdownMenuTrigger><DropdownMenuContent align="end">{["board", "list"].map(value => <DropdownMenuItem key={value} onClick={() => setView(value)}>{t(`landing.studio.${value}`)}</DropdownMenuItem>)}</DropdownMenuContent></DropdownMenu>
    </div></div>
    {filterOpen && <div className="product-task-filter"><Search aria-hidden /><Input type="search" aria-label={t("landing.demo.search")} placeholder={t("landing.demo.search")} value={query} onChange={event => onQuery?.(event.target.value)} /></div>}
    <div ref={viewport} className="product-task-columns" inert={automatic || undefined} aria-hidden={automatic || undefined}>
      {DEMO_TASK_STATUSES.map(status => <section key={status} className={`product-task-column ${statusColumnBg(status)}`} data-status={status}>
        <header><StatusHeading status={status} label={t(`tasks.status_${status}`)} count={visible.filter(task => task.state === status).length} /><span><Ellipsis aria-hidden /><Plus aria-hidden /></span></header>
        <div className="product-task-column-body" data-demo-motion-viewport>{visible.filter(task => task.state === status).length ? visible.filter(task => task.state === status).map(card) : <p>{t("tasks.surface.empty_column")}</p>}</div>
      </section>)}
    </div>
    {detailOpen && current && <aside className="product-task-details" data-demo-detail="task"><header><span>{current.identifier ?? "DEMO-111"}</span><Button variant="ghost" size="icon" data-action="close-task" data-demo-target="task-close" aria-label={t("common.close")} onClick={() => changeOpen(false)}><X aria-hidden /></Button></header><h2>{title(current)}</h2>
      <dl><div><dt>{t("tasks.status")}</dt><dd><DropdownMenu><DropdownMenuTrigger render={<Button variant="outline" size="sm" />}><StatusIcon status={current.state} />{t(`tasks.status_${current.state}`)}<ChevronDown aria-hidden /></DropdownMenuTrigger><DropdownMenuContent>{DEMO_TASK_STATUSES.map(status => <DropdownMenuItem key={status} onClick={() => onStatus?.(current.key, status)}><StatusIcon status={status} />{t(`tasks.status_${status}`)}</DropdownMenuItem>)}</DropdownMenuContent></DropdownMenu></dd></div>
      <div><dt>{t("landing.playback.assignee")}</dt><dd data-demo-target="assignee"><span className="product-task-assignee" data-demo-result={automatic && step >= 3 ? "assignee" : undefined}>{current.person ? <><i>{current.person.charAt(0)}</i>{DEMO_PEOPLE[current.person] ?? current.person}</> : t("tasks.unassigned")}</span></dd></div>
      <div><dt>{t("landing.playback.project")}</dt><dd>{t("landing.studio.launchProject")}</dd></div></dl>
      {automatic && step === 2 && <div className="product-task-member-menu">{["TN", "HA", "ML"].map(person => <span key={person} data-demo-target={person === "HA" ? "member" : undefined}><i>{person.charAt(0)}</i>{DEMO_PEOPLE[person]}</span>)}</div>}
      {!automatic && <div className="product-task-detail-actions"><Button variant="outline" size="sm" data-action="complete-task" onClick={() => onStatus?.(current.key, current.state === "done" ? "in_progress" : "done")}><Check aria-hidden />{t(current.state === "done" ? "landing.demo.reopen" : "landing.demo.complete")}</Button><Button variant="ghost" size="sm" onClick={onChat}><MessageSquare aria-hidden />{t("landing.demo.openDiscussion")}</Button></div>}
    </aside>}
  </div>;
}
