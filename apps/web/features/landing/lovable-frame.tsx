"use client";
import { Bell, CalendarDays, ChevronDown, CircleHelp, Globe, Grid2X2, House, Maximize2, Palette, PanelLeftClose, Plus, Search, Settings, ShieldCheck, Sparkles, Sun, X } from "lucide-react";
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Logo } from "@uniwork/ui/brand";
import { Button } from "@uniwork/ui/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@uniwork/ui/components/ui/dialog";
import { DEMO_FEATURES as PRODUCT_FEATURES, PRODUCT_GROUPS, type ProductFeature } from "./showcase";
import { LovableAssistant } from "./lovable-overviews";
import { LovableMeetings } from "./lovable-secondary";
import { MobileFeatureStory, useCompactPreview } from "./mobile-feature-story";

export function usePreviewLabels() {
  const { t } = useTranslation();
  return (key: string, options?: Record<string, string | number>) => t(`landing.lovable.${key}`, options);
}

/** A fitted desktop illustration, not a miniature set of interactive controls. */
export function LovableFrame({ feature, children, label, completed = false, playback, onSceneVisibilityChange }: { feature: ProductFeature; children: ReactNode; label: string; completed?: boolean; playback?: { running: boolean; reduced: boolean; pressing: boolean; control: ReactNode }; onSceneVisibilityChange?: (visible: boolean) => void }) {
  const [expanded, setExpanded] = useState(false);
  const [meetingList, setMeetingList] = useState(false);
  const compact = useCompactPreview();
  const copy = usePreviewLabels();
  const content = <FittedViewport feature={feature} label={meetingList ? copy("meetingList") : label} expanded={expanded} completed={completed}>{meetingList ? <LovableMeetings /> : children}</FittedViewport>;
  return <div className="lovable-preview">
    <div className="lovable-preview-tools"><span>{copy("reference")}<small>{copy("sample")}</small></span><div className="lovable-preview-actions">{!compact && !expanded && !meetingList && playback?.control}<Button size="sm" variant="ghost" data-action="expand-preview" onClick={() => setExpanded(true)}><Maximize2 aria-hidden />{copy("expand")}</Button></div></div>
    {feature === "meetings" && <div className="lovable-meeting-view-switch">{[true, false].map(list => <Button key={String(list)} size="sm" variant={meetingList === list ? "secondary" : "ghost"} aria-pressed={meetingList === list} onClick={() => { setMeetingList(list); onSceneVisibilityChange?.(!list); }}>{copy(list ? "meetingList" : "meetingRoom")}</Button>)}</div>}
    {!expanded && content}
    <Dialog open={expanded} onOpenChange={setExpanded}>
      <DialogContent className={`lovable-dialog${playback ? " product-playback" : ""}`} data-running={playback?.running} data-reduced={playback?.reduced} data-pressing={playback?.pressing} showCloseButton={false} style={{ width: "calc(100vw - 32px)", maxWidth: 1840, maxHeight: "calc(100dvh - 32px)" }}>
        <div className="lovable-dialog-heading"><div><DialogTitle>{copy("reference")}</DialogTitle><DialogDescription>{copy("sample")}</DialogDescription></div>{!compact && !meetingList && playback?.control}<Button variant="outline" size="icon" onClick={() => setExpanded(false)} aria-label={copy("close")}><X aria-hidden /></Button></div>
        {expanded && content}
      </DialogContent>
    </Dialog>
  </div>;
}

/** A static marketing illustration shares the app geometry without playback or dialogs. */
export function LovablePoster({ feature, children, label, completed = false }: { feature: ProductFeature; children: ReactNode; label: string; completed?: boolean }) {
  return <FittedViewport feature={feature} label={label} expanded={false} completed={completed} focused={false}>{children}</FittedViewport>;
}

function FittedViewport({ feature, children, label, expanded, completed, focused = true }: { feature: ProductFeature; children: ReactNode; label: string; expanded: boolean; completed: boolean; focused?: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [detail, setDetail] = useState(false);
  const compact = useCompactPreview() && focused;
  const copy = usePreviewLabels();
  useEffect(() => {
    const node = host.current;
    if (!node) return;
    const observer = new ResizeObserver(() => setWidth(node.clientWidth));
    setWidth(node.clientWidth);
    observer.observe(node);
    return () => observer.disconnect();
  }, [compact]);
  const scale = Math.min(1, (detail ? Math.max(width, 1200) : width) / 1760);
  if (compact) return <MobileFeatureStory key={feature} feature={feature} />;
  return <>
    {expanded && <Button className="lovable-detail-toggle" size="sm" variant="outline" aria-pressed={detail} onClick={() => setDetail(value => !value)}>{copy(detail ? "fit" : "detail")}</Button>}
    <div ref={host} className="lovable-viewport" data-detail={detail} style={{ "--preview-scale": scale || .55 } as CSSProperties}>
      <div className="lovable-viewport-spacer"><div className="lovable-canvas" role="img" aria-label={label} data-lovable-screen={feature}>
        <div className="lovable-application" inert aria-hidden="true">
        <LovableSidebar feature={feature} />
        <LovableToolbar />
        <div className="lovable-screen-body" data-assistant={["dashboard", "tasks", "email", "documents"].includes(feature)}>
          <div className="lovable-screen-content">{children}</div>
          {["dashboard", "tasks", "email", "documents"].includes(feature) && <LovableAssistant feature={feature} completed={completed} />}
        </div>
        </div>
      </div></div>
    </div>
  </>;
}

function LovableSidebar({ feature }: { feature: ProductFeature }) {
  const { t } = useTranslation();
  const copy = usePreviewLabels();
  const currentGroup = PRODUCT_FEATURES.find(item => item.key === feature)!.group;
  const navigation = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const nav = navigation.current;
    const selected = nav?.querySelector<HTMLElement>("[data-active=true]");
    if (nav && selected) nav.scrollTop = Math.max(0, selected.offsetTop - nav.offsetTop - nav.clientHeight + 90);
  }, [feature]);
  const item = (key: ProductFeature) => {
    const entry = PRODUCT_FEATURES.find(value => value.key === key)!;
    const Icon = key === "dashboard" ? House : entry.icon;
    return <div className="lovable-nav-item" key={key} data-active={feature === key}><Icon /><span>{key === "today" ? copy("mySpace") : key === "dashboard" ? copy("home") : t(entry.label)}</span>{key === "meetings" && <small>{copy("live")}</small>}</div>;
  };
  return <aside className="lovable-sidebar">
    <div className="lovable-brand"><Logo variant="lockup" size={30} decorative /></div>
    <div ref={navigation} className="lovable-navigation">
      {["dashboard", "today", "calendar"].map(key => item(key as ProductFeature))}
      {PRODUCT_GROUPS.map(group => <div className="lovable-nav-group" key={group.key}><div className="lovable-nav-group-title">{t(`landing.catalog.groups.${group.key}`)}<ChevronDown /></div>
        {(group.key === "work" || group.key === "communication" || group.key === "results" || group.key === currentGroup) && <>
          {group.key === "work" && <div className="lovable-nav-item"><Grid2X2 /><span>{copy("workspaces")}</span></div>}
          {group.key === "work" ? (["projects", "tasks", "workflows"] as const).map(item) : PRODUCT_FEATURES.filter(entry => entry.group === group.key).map(entry => item(entry.key))}
        </>}
      </div>)}
    </div>
    <div className="lovable-sidebar-bottom"><div><Settings />{copy("settings")}</div><div><CircleHelp />{copy("help")}</div><div><PanelLeftClose />{copy("collapse")}</div></div>
  </aside>;
}

function LovableToolbar() {
  const { i18n } = useTranslation();
  const copy = usePreviewLabels();
  return <div className="lovable-toolbar"><PanelLeftClose /><div className="lovable-global-search"><Search /><span>{copy("search")}</span><kbd>⌘K</kbd></div><span className="lovable-primary"><Plus />{copy("new")}</span><span className="lovable-ai-button"><Sparkles />AI</span><CircleHelp /><span className="lovable-language"><Globe />{i18n.language.startsWith("vi") ? "VI" : "EN"}</span><Palette /><Sun /><ShieldCheck /><Settings /><Bell /><CalendarDays /><div className="lovable-profile"><span>ML<i /></span><div><strong>Minh Linh</strong><small>{copy("member")}</small></div><ChevronDown /></div></div>;
}

export function LovablePageHeading({ title, subtitle, children }: { title: string; subtitle?: string; children?: ReactNode }) {
  return <div className="lovable-page-heading"><div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div>{children && <div className="lovable-heading-actions">{children}</div>}</div>;
}

export function LovableControl({ children, primary = false }: { children: ReactNode; primary?: boolean }) {
  return <span className={primary ? "lovable-primary" : "lovable-control"}>{children}</span>;
}
