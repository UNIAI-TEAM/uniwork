"use client";

import { useState } from "react";
import { Captions, Check, Circle, Clock, Ellipsis, Hand, LayoutGrid, Mic, MicOff, MonitorUp, PanelRightClose, PanelRightOpen, PhoneOff, Settings, Sparkles, Square, ThumbsUp, Video, VideoOff } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Logo } from "@uniwork/ui/brand";
import { Button } from "@uniwork/ui/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@uniwork/ui/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@uniwork/ui/components/ui/popover";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@uniwork/ui/components/ui/sheet";
import { TooltipProvider } from "@uniwork/ui/components/ui/tooltip";
import { useIsCompact } from "@uniwork/ui/hooks/use-mobile";
import { IconControl, MenuControl, MEETING_CHIP } from "@uniwork/views/meetings/meeting-control";
import { MEETING_DARK_BAR } from "@uniwork/views/meetings/meeting-dark-bar";
import { MeetingPersonAvatar } from "@uniwork/views/meetings/meeting-person";
import { MeetingLeaveConfirmDialog } from "@uniwork/views/meetings/meeting-leave-confirm-dialog";
import { MeetingRecordConfirmDialog } from "@uniwork/views/meetings/meeting-record-confirm-dialog";
import { ProductMeetingPanel, DEMO_MEETING_PEOPLE, useDemoMeetingPanelState, type DemoMeetingTab } from "./product-meeting-panel";

/** The real room's controls, tokens and avatars, driven only by local demo state. */
export function ProductMeetingRoom({ step, onLeave, onTask, meetingTitle }: { step?: number; onLeave: () => void; onTask?: (title: string) => void; meetingTitle?: string }) {
  const { t } = useTranslation();
  const compact = useIsCompact();
  const panelState = useDemoMeetingPanelState();
  const automatic = step !== undefined;
  const [mic, setMic] = useState(false);
  const [camera, setCamera] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [hand, setHand] = useState(false);
  const [captions, setCaptions] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recordConfirm, setRecordConfirm] = useState(false);
  const [leaveConfirm, setLeaveConfirm] = useState(false);
  const [devices, setDevices] = useState(false);
  const [more, setMore] = useState(false);
  const [spotlight, setSpotlight] = useState(false);
  const [reaction, setReaction] = useState(false);
  const [autoHide, setAutoHide] = useState(false);
  const [panel, setPanel] = useState(true);
  const [mobilePanel, setMobilePanel] = useState(false);
  const [tab, setTab] = useState<DemoMeetingTab>("copilot");
  const [sharePicker, setSharePicker] = useState(false);
  const [sourceSelected, setSourceSelected] = useState(false);
  const shared = automatic ? step === 3 : sharing;
  const panelVisible = compact ? mobilePanel : panel;
  const openPanel = (next: DemoMeetingTab) => { setTab(next); if (compact) setMobilePanel(true); else setPanel(true); };
  const closePanel = () => { setPanel(false); setMobilePanel(false); };
  const toggleShare = () => { if (shared) setSharing(false); else { setSourceSelected(false); setSharePicker(true); } };
  const toggleRecording = () => { if (recording) setRecording(false); else setRecordConfirm(true); };
  const sidebar = <ProductMeetingPanel tab={tab} onTab={setTab} onClose={closePanel} onTask={onTask} compact={compact} state={panelState} />;
  const share = <span className="product-meeting-secondary" data-demo-target={automatic && step === 0 ? "share-start" : undefined}><IconControl label={t("meetings.share")} pressed={shared} tone={shared ? "active" : undefined} onClick={toggleShare}><MonitorUp aria-hidden /></IconControl></span>;

  return <div className="product-meeting-conference" data-panel={panel && !compact}>
    <section className="product-meeting-video dark" aria-label={meetingTitle ?? t("landing.playback.meetingTitle")}>
      <header className="product-meeting-header">
        <div><small>{t("meetings.title")}</small><h2>{meetingTitle ?? t("landing.playback.meetingTitle")}</h2><p>{t("landing.playback.meetingGoal")}</p></div>
        <div className="product-meeting-header-actions">
          {recording && <strong className="product-meeting-recording">{t("meetings.recording")}</strong>}
          <span className="product-meeting-clock"><Clock aria-hidden /><time>12:38</time></span>
          <Button variant="ghost" size="sm" className="product-meeting-header-people" aria-label={t("meetings.roomPeopleView", { count: 4 })} onClick={() => openPanel("participants")}>{DEMO_MEETING_PEOPLE.map(name => <MeetingPersonAvatar key={name} name={name} tone="stage" />)}</Button>
          <Button variant="meetingChip" size="icon" aria-label={t("meetings.roomPanel")} aria-pressed={panelVisible} onClick={() => panelVisible ? closePanel() : openPanel(tab)}>{panelVisible ? <PanelRightClose aria-hidden /> : <PanelRightOpen aria-hidden />}</Button>
        </div>
      </header>
      <div className="product-meeting-tiles" data-sharing={shared} data-spotlight={spotlight}>
        {shared && <div className="product-meeting-shared" data-demo-result="screen"><div><MonitorUp aria-hidden />{t("meetings.sharedScreen")}</div><article><Logo variant="lockup" size={24} decorative /><h3>{t("landing.playback.project")}</h3><p>{t("landing.playback.meetingGoal")}</p><ol>{["brief", "design", "launch"].map(key => <li key={key}>{t(`landing.playback.tasks.${key}`)}</li>)}</ol></article></div>}
        <div className="product-meeting-people">{DEMO_MEETING_PEOPLE.map((name, index) => <div className="product-meeting-tile" key={name} data-self={index === 3} data-camera={index === 3 && camera}>
          <MeetingPersonAvatar name={name} size="stage" tone="stage" className="product-meeting-person-avatar" />
          {index === 3 && camera && <span className="product-meeting-camera-preview"><Video aria-hidden />{t("landing.meeting.cameraPreview")}</span>}
          <div className="product-meeting-tile-status">{index === 3 && hand && <Hand aria-label={t("meetings.handRaised")} />}{index !== 3 || !mic ? <MicOff aria-label={t("meetings.micIsOff")} /> : <Mic aria-hidden />}</div>
          {index === 3 && reaction && <ThumbsUp className="product-meeting-reaction" aria-hidden />}
          <span className="product-meeting-person-name">{index === 3 ? t("meetings.youSuffix", { name }) : name}</span>
        </div>)}</div>
      </div>
      {captions && <p className="product-meeting-captions">An Nhiên: {t("landing.reference.meetingChat")}</p>}
      <footer className="product-meeting-footer" data-auto-hide={autoHide}>
        <TooltipProvider><div className={MEETING_DARK_BAR} data-demo-meeting-controls>
          <IconControl label={t("meetings.mic")} pressed={mic} tone={mic ? "active" : "off"} onClick={() => setMic(value => !value)}>{mic ? <Mic aria-hidden /> : <MicOff aria-hidden />}</IconControl>
          <IconControl label={t("meetings.camera")} pressed={camera} tone={camera ? "active" : "off"} onClick={() => setCamera(value => !value)}>{camera ? <Video aria-hidden /> : <VideoOff aria-hidden />}</IconControl>
          {share}
          <span className="product-meeting-secondary"><IconControl label={t("meetings.devices")} onClick={() => setDevices(true)}><Settings aria-hidden /></IconControl></span>
          <span className="product-meeting-secondary"><IconControl label={t("meetings.hand")} pressed={hand} tone={hand ? "active" : undefined} onClick={() => setHand(value => !value)}><Hand aria-hidden /></IconControl></span>
          <IconControl label={t("meetings.aiCopilot")} pressed={panelVisible && tab === "copilot"} tone={panelVisible && tab === "copilot" ? "active" : undefined} onClick={() => panelVisible && tab === "copilot" ? closePanel() : openPanel("copilot")}><Sparkles aria-hidden /></IconControl>
          <span className="product-meeting-secondary"><IconControl label={t("meetings.captions")} pressed={captions} tone={captions ? "active" : undefined} onClick={() => setCaptions(value => !value)}><Captions aria-hidden /></IconControl></span>
          <span className="product-meeting-secondary"><IconControl label={t(recording ? "meetings.stopRecording" : "meetings.record")} tone={recording ? "off" : undefined} onClick={toggleRecording}>{recording ? <Square aria-hidden /> : <Circle aria-hidden />}</IconControl></span>
          <Popover open={more} onOpenChange={setMore}><PopoverTrigger render={<Button variant="meetingChip" size="icon-lg" className={MEETING_CHIP} aria-label={t("meetings.more")} />}><Ellipsis aria-hidden /></PopoverTrigger><PopoverContent side="top" className="dark product-meeting-more">
            {compact && <><MenuControl caption={t("meetings.share")} pressed={shared} onClick={() => { setMore(false); toggleShare(); }}><MonitorUp aria-hidden /></MenuControl><MenuControl caption={t("meetings.devices")} onClick={() => { setMore(false); setDevices(true); }}><Settings aria-hidden /></MenuControl><MenuControl caption={t("meetings.hand")} pressed={hand} onClick={() => setHand(value => !value)}><Hand aria-hidden /></MenuControl><MenuControl caption={t("meetings.captions")} pressed={captions} onClick={() => setCaptions(value => !value)}><Captions aria-hidden /></MenuControl><MenuControl caption={t(recording ? "meetings.stopRecording" : "meetings.record")} onClick={() => { setMore(false); toggleRecording(); }}><Circle aria-hidden /></MenuControl></>}
            <MenuControl caption={t("meetings.reactionThumbsUp")} pressed={reaction} onClick={() => setReaction(value => !value)}><ThumbsUp aria-hidden /></MenuControl>
            <MenuControl caption={t("meetings.adjustView")} pressed={spotlight} onClick={() => setSpotlight(value => !value)}><LayoutGrid aria-hidden /></MenuControl>
            <MenuControl caption={t("meetings.controlBarAutoHide")} pressed={autoHide} onClick={() => setAutoHide(value => !value)}><PanelRightClose aria-hidden /></MenuControl>
          </PopoverContent></Popover>
          <span className="product-meeting-control-divider" aria-hidden />
          <Button variant="destructiveSolid" size="icon-lg" className={MEETING_CHIP} aria-label={t("meetings.leave")} onClick={() => setLeaveConfirm(true)}><PhoneOff aria-hidden /></Button>
        </div></TooltipProvider>
      </footer>
      {automatic && (step === 1 || step === 2) && <div className="product-meeting-overlay"><SharePicker selected={step === 2} /></div>}
    </section>
    {!compact && panel && sidebar}
    {compact && <Sheet open={mobilePanel} onOpenChange={setMobilePanel}><SheetContent side="right" showCloseButton={false} className="product-meeting-sheet"><SheetHeader className="sr-only"><SheetTitle>{t("meetings.roomPanel")}</SheetTitle></SheetHeader>{sidebar}</SheetContent></Sheet>}
    <Dialog open={sharePicker} onOpenChange={setSharePicker}><DialogContent className="product-meeting-share-dialog"><DialogTitle>{t("landing.actionDemo.chooseWindow")}</DialogTitle><DialogDescription>{t("landing.actionDemo.systemSimulation")}</DialogDescription><SharePicker selected={sourceSelected} onSelect={() => setSourceSelected(true)} onCancel={() => setSharePicker(false)} onConfirm={() => { setSharing(true); setSharePicker(false); }} manual /></DialogContent></Dialog>
    <Dialog open={devices} onOpenChange={setDevices}><DialogContent><DialogTitle>{t("meetings.devicesSettingsTitle")}</DialogTitle><DialogDescription>{t("landing.meeting.localNote")}</DialogDescription>{["deviceMic", "deviceCamera", "deviceSpeaker"].map(key => <label className="product-meeting-device" key={key}>{t(`meetings.${key}`)}<select aria-label={t(`meetings.${key}`)} defaultValue="default"><option value="default">{t("landing.productDemo.deviceDefault")}</option></select></label>)}</DialogContent></Dialog>
    <MeetingRecordConfirmDialog open={recordConfirm} onOpenChange={setRecordConfirm} onConfirm={() => { setRecording(true); setRecordConfirm(false); }} />
    <MeetingLeaveConfirmDialog open={leaveConfirm} onOpenChange={setLeaveConfirm} onConfirm={() => { setLeaveConfirm(false); onLeave(); }} />
  </div>;
}

function SharePicker({ selected, onSelect, onCancel, onConfirm, manual = false }: { selected: boolean; onSelect?: () => void; onCancel?: () => void; onConfirm?: () => void; manual?: boolean }) {
  const { t } = useTranslation();
  return <div className="product-meeting-share-picker">
    {!manual && <><h3><MonitorUp aria-hidden />{t("landing.actionDemo.chooseWindow")}</h3><p>{t("landing.actionDemo.systemSimulation")}</p></>}
    <button type="button" data-demo-target="share-source" data-selected={selected} aria-pressed={selected} onClick={onSelect}><span><Logo variant="lockup" size={22} decorative /><strong>{t("landing.playback.project")}</strong></span><span>{t("landing.actionDemo.appWindow")}{selected && <Check aria-hidden />}</span></button>
    <footer><Button variant="ghost" size="sm" onClick={onCancel}>{t("common.cancel")}</Button><Button variant="brand" size="sm" data-demo-target="share-confirm" disabled={!selected} onClick={onConfirm}>{t("landing.actionDemo.share")}</Button></footer>
  </div>;
}
