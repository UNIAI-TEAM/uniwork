"use client";
import { Check, Ellipsis, Hash, House, Info, ListChecks, MessagesSquare, Mic, Paperclip, Phone, Plus, Reply, RotateCcw, Search, Settings, FaceSlightlySmiling, Sparkles, SquareCheck, SquarePen, Users, Video } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { DEMO_MEMBERS } from "../product-demo-data";

// The viewer is Mai An (DEMO_MEMBERS[0]): their message is the own bubble.
const [, AN_NHIEN, KHANH_VY, BAO_LAM, GIA_MINH] = DEMO_MEMBERS;
const first = (name: string) => name.trim().charAt(0).toUpperCase();

function Avatar({ initials, online = false }: { initials: string; online?: boolean }) {
  return <span className={online ? "uc-av is-online" : "uc-av"}>{initials}</span>;
}

/** The desktop app: the conversation list beside the open channel. */
function DesktopWindow() {
  const { t } = useTranslation();
  const s = (key: string) => t(`landing.unichat.stage.${key}`);
  return <div className="uc-win">
    <div className="uc-win-bar"><span /><span /><span /><b>UniChat</b></div>
    <div className="uc-win-body">
      <div className="uc-list">
        <div className="uc-list-head"><b>{s("chats")}</b><span className="uc-tools"><ListChecks /><span className="uc-tool-box"><Plus /></span></span></div>
        <div className="uc-search"><Search />{s("search")}</div>
        <div className="uc-tabs"><span className="is-on">{s("tabs.all")}</span><span>{s("tabs.direct")}</span><span>{s("tabs.groups")}</span><span>{s("tabs.channels")}</span></div>
        <div className="uc-chips"><span className="is-on">{s("filters.all")}</span><span>{s("filters.unread")}</span><span>{s("filters.mentions")}</span></div>
        <div className="uc-catch"><span className="uc-catch-icon"><Sparkles /></span><span><b>{s("catchUp.title")}</b><small>{s("catchUp.body")}</small></span></div>
        <div className="uc-rows">
          <div className="uc-row is-on"><span className="uc-mark is-solid"><Hash /></span><span><b>{s("channel")}</b><small>{s("you")}: {s("previews.reply")}</small></span><time>09:14</time></div>
          <div className="uc-row"><Avatar initials={KHANH_VY!.initials} online /><span><b>{KHANH_VY!.name}</b><small>{s("previews.file")}</small></span><time>09:02</time></div>
          <div className="uc-row"><Avatar initials={GIA_MINH!.initials} /><span><b>{GIA_MINH!.name}</b><small>{s("previews.poll")}</small></span><time>08:47<em className="uc-badge">2</em></time></div>
          <div className="uc-row"><span className="uc-mark"><Hash /></span><span><b>{s("design")}</b><small>{BAO_LAM!.name}: {s("previews.voice")}</small></span><time>{s("yesterday")}<em className="uc-badge is-mention">@</em></time></div>
          <div className="uc-row"><span className="uc-mark"><House /></span><span><b>Demo Studio</b><small>{AN_NHIEN!.name}: {s("previews.calendar")}</small></span><time>{s("yesterday")}</time></div>
        </div>
      </div>
      <div className="uc-conv">
        <div className="uc-conv-head"><span className="uc-mark is-header"><Hash /></span><span><b>{s("channel")}</b><small>{s("members")}</small></span><span className="uc-tools"><Sparkles /><Phone /><Video /><Info /></span></div>
        <div className="uc-wall">
          <span className="uc-day">{s("today")}</span>
          <div className="uc-in"><Avatar initials={GIA_MINH!.initials} /><div><div className="uc-bubble"><b className="uc-sender is-4">{GIA_MINH!.name}</b><p>{s("messages.review")}</p></div><time>08:47</time></div></div>
          <div className="uc-in uc-anim-ask"><Avatar initials={KHANH_VY!.initials} online /><div>
            <div className="uc-bubble"><b className="uc-sender is-1">{KHANH_VY!.name}</b><p>{s("messages.ask")}</p>
              <span className="uc-hover"><FaceSlightlySmiling /><Reply /><span className="is-on"><ListChecks />{s("createTask")}</span><Ellipsis /></span>
            </div>
            <span className="uc-task uc-anim-task"><SquareCheck /><span className="uc-task-id">DEMO-111</span><span className="uc-task-title">{s("task")}</span><span className="uc-task-status"><i />{s("taskStatus")}</span></span>
            <time>09:12</time>
          </div></div>
          <div className="uc-own uc-anim-reply"><div className="uc-bubble is-own"><p>{s("messages.reply")}</p></div><time>09:14 · <span className="uc-read"><Check />{s("read")}</span></time></div>
        </div>
        <div className="uc-composer"><span className="uc-composer-plus"><Plus /></span><span className="uc-composer-field"><FaceSlightlySmiling /><span>{s("composer")}</span><Paperclip /></span><span className="uc-composer-mic"><Mic /></span></div>
      </div>
    </div>
  </div>;
}

/** The phone app's chat tab: the same room updates as the desktop conversation moves. */
function PhoneScreen() {
  const { t } = useTranslation();
  const s = (key: string) => t(`landing.unichat.stage.${key}`);
  return <div className="uc-phone">
    <div className="uc-screen">
      <div className="uc-phone-head"><b>{s("chats")}</b><span><SquarePen /></span></div>
      <div className="uc-phone-search"><Search />{s("search")}</div>
      <div className="uc-phone-rows">
        <div className="uc-prow"><span className="uc-pav is-room"><Hash /></span><span className="uc-prow-main"><span className="uc-prow-top"><b>{s("channel")}</b><time className="uc-swap"><span className="uc-x1">08:47</span><span className="uc-x2">09:12</span><span className="uc-x3">09:14</span></time></span><span className="uc-prow-bottom"><span className="uc-swap"><span className="uc-x1">{GIA_MINH!.name}: {s("previews.review")}</span><span className="uc-x2 is-unread">{KHANH_VY!.name}: {s("previews.ask")}</span><span className="uc-x3">{s("you")}: {s("previews.reply")}</span></span><em className="uc-badge uc-x2b">1</em></span></span></div>
        <div className="uc-prow"><span className="uc-pav is-person is-online">{first(KHANH_VY!.name)}</span><span className="uc-prow-main"><span className="uc-prow-top"><b>{KHANH_VY!.name}</b><time>09:02</time></span><span className="uc-prow-bottom"><span>{s("previews.file")}</span></span></span></div>
        <div className="uc-prow"><span className="uc-pav is-person">{first(GIA_MINH!.name)}</span><span className="uc-prow-main"><span className="uc-prow-top"><b>{GIA_MINH!.name}</b><time className="is-unread">08:47</time></span><span className="uc-prow-bottom"><span className="is-unread">{s("previews.poll")}</span><em className="uc-badge">2</em></span></span></div>
        <div className="uc-prow"><span className="uc-pav is-room"><Hash /></span><span className="uc-prow-main"><span className="uc-prow-top"><b>{s("design")}</b><time>{s("yesterday")}</time></span><span className="uc-prow-bottom"><span>{BAO_LAM!.name}: {s("previews.voice")}</span></span></span></div>
        <div className="uc-prow"><span className="uc-pav is-room"><House /></span><span className="uc-prow-main"><span className="uc-prow-top"><b>Demo Studio</b><time>{s("yesterday")}</time></span><span className="uc-prow-bottom"><span>{AN_NHIEN!.name}: {s("previews.calendar")}</span></span></span></div>
        <div className="uc-prow"><span className="uc-pav is-person is-online">{first(BAO_LAM!.name)}</span><span className="uc-prow-main"><span className="uc-prow-top"><b>{BAO_LAM!.name}</b><time>{s("monday")}</time></span><span className="uc-prow-bottom"><span>{s("previews.thanks")}</span></span></span></div>
      </div>
      <div className="uc-phone-tabs"><span className="is-on"><MessagesSquare />{s("phoneTabs.chats")}</span><span><Phone />{s("phoneTabs.calls")}</span><span><Users />{s("phoneTabs.contacts")}</span><span><Settings />{s("phoneTabs.settings")}</span></div>
    </div>
  </div>;
}

/**
 * The hero's stage: a picture of the real chat, drawn from its tokens, that
 * plays once — a message arrives, is answered and becomes a task — while the
 * phone's list follows. Replay remounts it; reduced motion shows the end state.
 */
export function UniChatStage() {
  const { t } = useTranslation();
  const [run, setRun] = useState(0);
  return <div className="uc-band">
    <div key={run} className="uc-art is-playing" role="img" aria-label={t("landing.unichat.stage.label")}>
      <div aria-hidden className="uc-art-inner"><DesktopWindow /><PhoneScreen /></div>
    </div>
    <button type="button" className="uc-replay" onClick={() => setRun((value) => value + 1)}><RotateCcw aria-hidden />{t("landing.unichat.stage.replay")}</button>
  </div>;
}
