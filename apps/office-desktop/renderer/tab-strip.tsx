import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import { Logo } from "@uniwork/ui/brand";
import { Avatar, AvatarFallback } from "@uniwork/ui/components/ui/avatar";
import { Button } from "@uniwork/ui/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@uniwork/ui/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from "@uniwork/ui/components/ui/popover";
import { DocumentTypeIcon } from "@uniwork/views/documents/document-type-icon";

export type DesktopTabSummary = { id: string; title: string; format: string; dirty: boolean; saving?: boolean };

interface DesktopTabStripProps {
  tabs: readonly DesktopTabSummary[];
  activeTabId: string | null;
  onSelect: (id: string | null) => void;
  onClose: (id: string) => void;
  onCreate: () => void;
  onOpenLocal: () => void;
  createDisabled?: boolean;
  busy?: boolean;
  signedOut?: boolean;
  /** Local mode pins a "Trên máy" home tab instead of the cloud library and
   * swaps the account menu for a sign-in button. */
  mode?: "cloud" | "local";
  onSignIn?: () => void;
  accountName?: string;
  accountEmail?: string;
  onSwitchWorkspace?: () => void;
  onSignOut: () => void;
}

function ChromeIcon({ kind }: { kind: "library" | "home" | "plus" | "down" | "close" }) {
  const paths = { library: "M4 4h4v16H4zM11 4h3v16h-3zM17 4l3-1 4 16-3 1z", home: "M4 6a2 2 0 0 1 2-2h4l2 2h6a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z", plus: "M12 5v14M5 12h14", down: "m6 9 6 6 6-6", close: "m6 6 12 12M18 6 6 18" };
  return <svg className="size-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[kind]} /></svg>;
}

export function DesktopTabStrip({ tabs, activeTabId, onSelect, onClose, onCreate, onOpenLocal, createDisabled = false, busy = false, signedOut = false, mode = "cloud", onSignIn, accountName, accountEmail, onSwitchWorkspace, onSignOut }: DesktopTabStripProps) {
  const { t } = useTranslation(undefined, { keyPrefix: "officeDesktop.tabs" });
  const [createOpen, setCreateOpen] = useState(false);
  const [allOpen, setAllOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLElement>(null);
  const createRef = useRef<HTMLButtonElement>(null);
  const homeKind = mode === "local" ? "local" : "library";
  const homeTabId = `desktop-tab-${homeKind}`;
  const homePanelId = `desktop-panel-${homeKind}`;
  const homeLabel = t(homeKind);
  const homeIcon = mode === "local" ? "home" as const : "library" as const;
  const displayName = accountName?.trim() || t("accountUnknown");
  const initials = displayName.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();

  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (!signedOut && (event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "t") {
        event.preventDefault();
        createRef.current?.focus();
        setCreateOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [signedOut]);

  useEffect(() => {
    const strip = scrollRef.current;
    if (!strip) return;
    const scroll = (event: WheelEvent) => {
      if (strip.scrollWidth <= strip.clientWidth || Math.abs(event.deltaX) >= Math.abs(event.deltaY)) return;
      event.preventDefault();
      const scale = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? strip.clientWidth : 1;
      strip.scrollLeft += event.deltaY * scale;
    };
    strip.addEventListener("wheel", scroll, { passive: false });
    return () => strip.removeEventListener("wheel", scroll);
  }, [signedOut]);

  useEffect(() => {
    const reveal = () => barRef.current?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
    reveal();
    const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(reveal);
    if (scrollRef.current) observer?.observe(scrollRef.current);
    return () => observer?.disconnect();
  }, [activeTabId, tabs.length, signedOut]);

  const onTabKey = (event: KeyboardEvent<HTMLButtonElement>, id: string | null) => {
    const ids = [null, ...tabs.map((tab) => tab.id)];
    const index = ids.indexOf(id);
    const next = event.key === "Home" ? 0 : event.key === "End" ? ids.length - 1 : event.key === "ArrowRight" ? (index + 1) % ids.length : event.key === "ArrowLeft" ? (index + ids.length - 1) % ids.length : -1;
    if (next < 0) return;
    event.preventDefault();
    const target = ids[next] ?? null;
    onSelect(target);
    document.getElementById(target === null ? homeTabId : `desktop-tab-${target}`)?.focus();
  };
  const state = (tab: DesktopTabSummary) => tab.saving ? t("saving") : tab.dirty ? t("dirty") : undefined;

  if (signedOut) return <header className="desktop-titlebar desktop-tabbar bg-muted text-foreground"><div className="desktop-logo-cell"><Logo variant="mark" size={20} /></div><span className="self-center text-caption">{t("appTitle")}</span></header>;

  return (
    <header ref={barRef} className="desktop-titlebar desktop-tabbar bg-muted text-foreground" data-desktop-tabbar>
      <div className="desktop-logo-cell"><Logo variant="mark" size={20} /></div>
      <div role="tablist" aria-label={t("label")} className="desktop-tablist">
        <button type="button" role="tab" id={homeTabId} aria-controls={homePanelId} aria-selected={activeTabId === null} tabIndex={activeTabId === null ? 0 : -1} className="desktop-library-tab desktop-tab-select text-caption" onClick={() => onSelect(null)} onKeyDown={(event) => onTabKey(event, null)}>
          <ChromeIcon kind={homeIcon} /><span>{homeLabel}</span>
        </button>
        <div ref={scrollRef} className="desktop-tab-scroll" data-desktop-tab-scroll>
          {tabs.map((tab) => (
            <div key={tab.id} className="desktop-document-tab" data-active={tab.id === activeTabId}>
              <button type="button" role="tab" id={`desktop-tab-${tab.id}`} aria-controls={`desktop-panel-${tab.id}`} aria-selected={tab.id === activeTabId} aria-describedby={state(tab) ? `desktop-tab-state-${tab.id}` : undefined} tabIndex={tab.id === activeTabId ? 0 : -1} title={tab.title} className="desktop-tab-select min-w-0 flex-1 text-caption" onClick={() => onSelect(tab.id)} onKeyDown={(event) => onTabKey(event, tab.id)}>
                <DocumentTypeIcon format={tab.format} className="size-4 shrink-0" /><span className="truncate">{tab.title}</span>
              </button>
              {state(tab) ? <span id={`desktop-tab-state-${tab.id}`} role="img" aria-label={state(tab)} className={`desktop-tab-state ${tab.saving ? "desktop-tab-saving" : ""}`} /> : null}
              <button type="button" className="desktop-tab-close" aria-label={t("close", { name: tab.title })} title={t("close", { name: tab.title })} aria-disabled={tab.saving} onClick={() => { if (!tab.saving) onClose(tab.id); }}><ChromeIcon kind="close" /></button>
            </div>
          ))}
        </div>
      </div>
      <div className="desktop-tab-actions">
        <DropdownMenu open={createOpen} onOpenChange={setCreateOpen}>
          <DropdownMenuTrigger ref={createRef} className="desktop-chrome-button" aria-label={t("newTab")} title={t("newTab")}><ChromeIcon kind="plus" /></DropdownMenuTrigger>
          <DropdownMenuContent className="desktop-chrome-popup">
            <DropdownMenuItem disabled={busy || createDisabled} onClick={onCreate}><DocumentTypeIcon format="docx" className="size-4" />{t("createDocx")}</DropdownMenuItem>
            <DropdownMenuItem disabled={busy} onClick={onOpenLocal}>{t("openLocal")}</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <Popover open={allOpen} onOpenChange={setAllOpen}>
          <PopoverTrigger className="desktop-chrome-button" aria-label={t("allTabs")} title={t("allTabs")}><ChromeIcon kind="down" /></PopoverTrigger>
          <PopoverContent align="end" className="desktop-chrome-popup max-h-96 overflow-y-auto">
            <PopoverTitle>{t("allTabs")}</PopoverTitle>
            <Button variant="ghost" className="justify-start" aria-pressed={activeTabId === null} onClick={() => { onSelect(null); setAllOpen(false); }}><ChromeIcon kind={homeIcon} />{homeLabel}</Button>
            {tabs.map((tab) => <Button key={tab.id} variant="ghost" className="justify-start" title={tab.title} aria-pressed={activeTabId === tab.id} onClick={() => { onSelect(tab.id); setAllOpen(false); }}><DocumentTypeIcon format={tab.format} className="size-4 shrink-0" /><span className="truncate">{tab.title}</span>{state(tab) ? <span className="sr-only">{state(tab)}</span> : null}</Button>)}
          </PopoverContent>
        </Popover>
      </div>
      <div className="desktop-tab-drag-space" />
      {mode === "local" ? (
        onSignIn ? <Button type="button" size="sm" variant="outline" className="desktop-sign-in-button" onClick={onSignIn}>{t("signIn")}</Button> : null
      ) : (
      <DropdownMenu>
        <DropdownMenuTrigger className="desktop-chrome-button desktop-account-button" aria-label={t("account", { name: displayName })} title={displayName}><Avatar size="sm" aria-hidden="true"><AvatarFallback>{initials}</AvatarFallback></Avatar></DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="desktop-chrome-popup w-64">
          <div className="px-2 py-2"><p className="break-words text-label font-medium">{displayName}</p>{accountEmail ? <p className="break-words text-caption text-muted-foreground">{accountEmail}</p> : null}</div>
          <DropdownMenuSeparator />
          {onSwitchWorkspace ? <DropdownMenuItem disabled={busy} onClick={onSwitchWorkspace}>{t("switchWorkspace")}</DropdownMenuItem> : null}
          <DropdownMenuItem disabled={busy} onClick={onSignOut}>{t("signOut")}</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      )}
    </header>
  );
}
