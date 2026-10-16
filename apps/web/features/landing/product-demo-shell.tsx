"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Bell, ChevronDown, MousePointer2, PanelLeft, Play, Plus, Search, Sparkles, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { MODULE_ICONS } from "@uniwork/views/layout/module-icons";
import { MODULE_TONES, type ModuleKey } from "@uniwork/views/layout/module-tones";
import { IconTile } from "@uniwork/ui/components/common/icon-tile";
import { Button } from "@uniwork/ui/components/ui/button";
import { Input } from "@uniwork/ui/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@uniwork/ui/components/ui/dialog";
import { TabsList, TabsTrigger } from "@uniwork/ui/components/ui/tabs";
import { ProductDemoPlaybackSlot } from "./product-demo-playback-slot";
import { DEMO_FEATURES, PRODUCT_GROUPS, type ProductFeature } from "./showcase";
import { hasPlayback } from "./product-playback";
import { EmbeddedProductDemo } from "./product-demo-context";
import { MarketingPreferences } from "../../platform/marketing-preferences";

export type DemoDestination = ProductFeature | "inbox";

const APP_MODULES: Partial<Record<DemoDestination, ModuleKey>> = {
  dashboard: "home", inbox: "inbox", tasks: "tasks", today: "my_tasks", projects: "projects",
  calendar: "calendar", email: "email", meetings: "meetings", documents: "documents", chat: "chat", organization: "people",
};
const GROUPS = [
  { label: undefined, items: ["dashboard", "inbox"] },
  { label: "nav.group_work", items: ["tasks", "today", "projects", "calendar"] },
  { label: "nav.group_communication", items: ["email", "meetings", "documents", "chat", "organization"] },
] as const;

function demoLabel(key: DemoDestination): string {
  const moduleKey = APP_MODULES[key];
  return moduleKey ? `nav.${moduleKey}` : DEMO_FEATURES.find(item => item.key === key)!.label;
}

/** One usable app menu surrounds both the local sandbox and the retained concept scenes. */
export function ProductDemoShell({ mode, onSelect, onCreate, watch, onWatch, children }: {
  mode: DemoDestination; onSelect: (key: DemoDestination) => void;
  onCreate: (title: string) => void;
  watch: boolean; onWatch: () => void; children: ReactNode;
}) {
  const { t } = useTranslation();
  const [menuOpen, setMenuOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [taskTitle, setTaskTitle] = useState("");
  const [playbackSlot, setPlaybackSlot] = useState<HTMLDivElement | null>(null);
  const search = useRef<HTMLInputElement>(null);
  const shell = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (shell.current?.closest("[inert]")) return;
    const handleKey = (event: KeyboardEvent) => {
      if (!shell.current?.contains(event.target as Node)) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") { event.preventDefault(); search.current?.focus(); }
      if (event.key === "Escape") { setMenuOpen(false); setSearchOpen(false); shell.current.querySelector<HTMLButtonElement>('[data-action="toggle-demo-menu"]')?.focus(); }
      if (menuOpen && event.key === "Tab") {
        const buttons = Array.from(shell.current.querySelectorAll<HTMLButtonElement>('.product-demo-sidebar button:not([tabindex="-1"])'));
        const first = buttons[0], last = buttons.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [menuOpen]);
  useEffect(() => {
    if (menuOpen) shell.current?.querySelector<HTMLButtonElement>('.product-demo-sidebar [role=tab][aria-selected=true]')?.focus();
  }, [menuOpen]);
  const destinations: DemoDestination[] = ["dashboard", "inbox", ...DEMO_FEATURES.filter(item => item.key !== "dashboard").map(item => item.key)];
  const matches = destinations.filter(key => t(demoLabel(key)).toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const select = (key: DemoDestination) => {
    onSelect(key); setMenuOpen(false); setQuery(""); setSearchOpen(false);
    if (menuOpen) requestAnimationFrame(() => shell.current?.querySelector<HTMLElement>('[role=tabpanel]:not([hidden])')?.focus({ preventScroll: true }));
  };
  const closeMenu = () => { setMenuOpen(false); shell.current?.querySelector<HTMLButtonElement>('[data-action="toggle-demo-menu"]')?.focus(); };
  const moduleKey = APP_MODULES[mode];
  const ActiveIcon = moduleKey ? MODULE_ICONS[moduleKey] : DEMO_FEATURES.find(item => item.key === mode)!.icon;
  const item = (key: DemoDestination) => {
    const moduleKey = APP_MODULES[key];
    const entry = DEMO_FEATURES.find(value => value.key === key);
    const Icon = moduleKey ? MODULE_ICONS[moduleKey] : entry!.icon;
    return <TabsTrigger key={key} value={key} data-feature={key} aria-label={t(demoLabel(key))} title={t(demoLabel(key))} onClick={() => select(key)}>
      <IconTile icon={Icon} tone={moduleKey ? MODULE_TONES[moduleKey] : "gray"} variant="solid" size="xs" />
      <span>{t(demoLabel(key))}</span>
    </TabsTrigger>;
  };
  const content = <EmbeddedProductDemo.Provider value>
    <div ref={shell} className="product-demo-shell" data-demo-feature={mode} data-menu-open={menuOpen} data-collapsed={collapsed}>
      <aside className="product-demo-sidebar">
        <div className="product-demo-workspace"><span className="product-demo-workspace-mark">U</span><span><small>UNICOM TECHNOLOGY</small><strong>UNICOM</strong></span><ChevronDown aria-hidden /><Button className="product-demo-sidebar-close" variant="ghost" size="icon" aria-label={t("common.close")} onClick={closeMenu}><X aria-hidden /></Button></div>
        <nav aria-label={t("landing.workspace.appNavigation")}>
          <TabsList className="product-demo-menu" activateOnFocus={false} aria-label={t("landing.catalog.navigation")}>
            {GROUPS.map((group, index) => <div className="product-demo-nav-group" key={index}>{group.label && <span className="product-demo-group-label">{t(group.label)}</span>}{group.items.map(item)}</div>)}
            {PRODUCT_GROUPS.map(group => {
              const remaining = DEMO_FEATURES.filter(entry => entry.group === group.key && !APP_MODULES[entry.key]);
              return remaining.length ? <div className="product-demo-nav-group" key={group.key}><span className="product-demo-group-label">{t(`landing.catalog.groups.${group.key}`)}</span>{remaining.map(entry => item(entry.key))}</div> : null;
            })}
          </TabsList>
        </nav>
        <div className="product-demo-profile"><span>Đ</span><div><strong>Đạt Đặng</strong><small>{t("landing.lovable.member")}</small></div></div>
      </aside>
      {menuOpen && <button type="button" className="product-demo-menu-backdrop" aria-label={t("landing.lovable.close")} tabIndex={-1} onClick={closeMenu} />}
      <div className="product-demo-app">
        <div className="product-demo-toolbar">
          <Button variant="ghost" size="icon" data-action="toggle-demo-menu" aria-label={t("landing.workspace.appNavigation")} aria-expanded={menuOpen} onClick={() => setMenuOpen(value => !value)}><PanelLeft aria-hidden /></Button>
          <Button variant="ghost" size="icon" data-action="toggle-demo-sidebar" aria-label={t("landing.lovable.collapse")} aria-expanded={!collapsed} onClick={() => setCollapsed(value => !value)}><PanelLeft aria-hidden /></Button>
          <div className="product-demo-search" onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setSearchOpen(false); }}>
            <Search aria-hidden /><Input ref={search} type="search" value={query} aria-label={t("landing.productDemo.search")} placeholder={t("landing.productDemo.search")} onFocus={() => setSearchOpen(true)} onChange={event => { setQuery(event.target.value); setSearchOpen(true); }} onKeyDown={event => {
              if (event.key === "Enter" && matches[0]) { event.preventDefault(); select(matches[0]); search.current?.blur(); }
              if (event.key === "ArrowDown") { event.preventDefault(); shell.current?.querySelector<HTMLButtonElement>(".product-demo-search-results button")?.focus(); }
            }} /><kbd>Ctrl+K</kbd>
            {searchOpen && <div className="product-demo-search-results" onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget) && event.relatedTarget !== search.current) setSearchOpen(false); }}>
              {matches.length ? matches.map(key => <Button variant="ghost" key={key} onClick={() => select(key)}>{t(demoLabel(key))}</Button>) : <p role="status">{t("landing.demo.noResults")}</p>}
              <Button variant="ghost" onClick={() => setSearchOpen(false)}><X aria-hidden />{t("common.close")}</Button>
            </div>}
          </div>
          <div className="product-demo-toolbar-actions">
            <Button variant="ghost" size="icon" aria-label={t("ai.title")} onClick={() => select("ask")}><Sparkles aria-hidden /></Button>
            <Button variant="ghost" size="icon" aria-label={t("nav.inbox")} onClick={() => select("inbox")}><Bell aria-hidden /></Button>
            <Button variant="ghost" size="icon" aria-label={t("home.start.create_task")} aria-haspopup="dialog" onClick={() => { setTaskTitle(""); setCreating(true); }}><Plus aria-hidden /></Button>
            <MarketingPreferences />
          </div>
          {["email", "chat", "ask"].includes(mode) && <div className="product-demo-email-presentation"><Button size="icon" variant="ghost" data-action="toggle-presentation" aria-label={t(watch ? "landing.playback.explore" : "landing.playback.watch")} onClick={onWatch}>{watch ? <MousePointer2 aria-hidden /> : <Play aria-hidden />}</Button>{watch && <div ref={setPlaybackSlot} className="product-demo-email-playback-slot" />}</div>}
        </div>
        {!["email", "chat", "ask", "documents", "projects", "organization", "calendar"].includes(mode) && <div className="product-demo-breadcrumb"><ActiveIcon aria-hidden /><span>{t(demoLabel(mode))}</span><div>{mode !== "inbox" && hasPlayback(mode) && <Button size="sm" variant="ghost" data-action="toggle-presentation" onClick={onWatch}>{t(watch ? "landing.playback.explore" : "landing.playback.watch")}</Button>}</div></div>}
        <div className="product-demo-content"><ProductDemoPlaybackSlot.Provider value={playbackSlot}>{children}</ProductDemoPlaybackSlot.Provider></div>
      </div>
    </div>
  </EmbeddedProductDemo.Provider>;
  return <>
    {content}
    <Dialog open={creating} onOpenChange={setCreating}><DialogContent><DialogTitle>{t("home.start.create_task")}</DialogTitle><DialogDescription>{t("landing.lovable.sample")}</DialogDescription><form className="product-demo-create" onSubmit={event => { event.preventDefault(); if (taskTitle.trim()) { onCreate(taskTitle.trim()); setCreating(false); } }}><label>{t("meetings.meetingTitle")}<Input autoFocus required maxLength={160} value={taskTitle} onChange={event => setTaskTitle(event.target.value)} /></label><div><Button type="button" variant="outline" onClick={() => setCreating(false)}>{t("common.cancel")}</Button><Button type="submit" disabled={!taskTitle.trim()}>{t("common.create")}</Button></div></form></DialogContent></Dialog>
  </>;
}
