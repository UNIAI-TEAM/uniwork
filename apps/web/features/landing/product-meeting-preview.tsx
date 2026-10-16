"use client";

import { useState, type ReactNode, type RefCallback } from "react";
import { Clock, Video } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import { MeetingPersonAvatar } from "@uniwork/views/meetings/meeting-person";
import { MeetingStatusBadge } from "@uniwork/views/meetings/meeting-status-badge";
import { ProductMeetingRoom } from "./product-meeting-room";

/** Room and list share one fitted app viewport in both playback and manual mode. */
export function ProductMeetingPreview({ step, control, cursor, stageRef, label, onSceneVisibilityChange, onTask, listFooter }: {
  step?: number; control?: ReactNode; cursor?: ReactNode; stageRef?: RefCallback<HTMLDivElement>;
  label?: string; onSceneVisibilityChange?: (visible: boolean) => void;
  onTask?: (title: string) => void; listFooter?: ReactNode;
}) {
  const { t } = useTranslation();
  const [list, setList] = useState(false);
  const [meetingTitle, setMeetingTitle] = useState<string>();
  const changeView = (value: boolean) => { setList(value); onSceneVisibilityChange?.(!value); };
  return <div className="product-meeting-preview">
    <div className="product-meeting-view-switch">{[true, false].map(value => <Button key={String(value)} variant={list === value ? "secondary" : "ghost"} size="sm" aria-pressed={list === value} onClick={() => changeView(value)}>{t(value ? "landing.lovable.meetingList" : "landing.lovable.meetingRoom")}</Button>)}<div>{control}</div></div>
    {list ? <div className="product-meeting-list"><header><div><h2>{t("meetings.title")}</h2><p>{t("landing.lovable.meetingsSub")}</p></div></header><h3>{t("landing.lovable.today")}</h3>
      {["sync", "designReview", "launchPlan", "weeklyReport"].map((key, index) => <article key={key}><time><Clock aria-hidden />{["09:30", "11:00", "14:00", "15:30"][index]}</time><MeetingPersonAvatar name="Minh Linh" /><div><strong>{t(`landing.lovable.${key}`)}</strong><small>Minh Linh · 30 {t("landing.lovable.minutes")}</small></div><MeetingStatusBadge status={index === 0 ? "IN_PROGRESS" : "SCHEDULED"} /><Button variant={index === 0 ? "brand" : "outline"} size="sm" onClick={() => { setMeetingTitle(t(`landing.lovable.${key}`)); changeView(false); }}><Video aria-hidden />{t("meetings.join")}</Button></article>)}
      {listFooter}
    </div> : <div ref={stageRef} className="product-meeting-stage" data-scene-kind="meetings" role={step !== undefined ? "img" : undefined} aria-label={step !== undefined ? label : undefined}>
      <div className="product-meeting-scene" inert={step !== undefined || undefined} aria-hidden={step !== undefined || undefined}><ProductMeetingRoom meetingTitle={meetingTitle} step={step} onLeave={() => changeView(true)} onTask={onTask} /></div>
      {cursor}
    </div>}
  </div>;
}
