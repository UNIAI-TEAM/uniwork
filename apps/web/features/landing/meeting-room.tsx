"use client";
import { Check, Mic, MicOff, MonitorUp, Radio, UsersRound, Video, VideoOff } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

const PEOPLE = [{ name: "Minh Linh", initials: "ML" }, { name: "Hoàng Anh", initials: "HA" }, { name: "Linh Trần", initials: "LT" }] as const;

/** Local preview only: never request media, capture a screen or join a room. */
export function MeetingRoom() {
  const { t } = useTranslation();
  const [mic, setMic] = useState(false);
  const [camera, setCamera] = useState(false);
  const [sharing, setSharing] = useState(true);
  const [people, setPeople] = useState(false);
  const controls = [
    { key: "mic", icon: mic ? Mic : MicOff, active: mic, action: () => setMic(!mic) },
    { key: "camera", icon: camera ? Video : VideoOff, active: camera, action: () => setCamera(!camera) },
    { key: "share", icon: MonitorUp, active: sharing, action: () => setSharing(!sharing) },
  ] as const;
  return <figure className="meeting-room dark">
    <figcaption><span><Video aria-hidden />{t("landing.meeting.roomTitle")}</span><span>{t("landing.studio.illustration")}</span></figcaption>
    <div className="meeting-room-stage" data-sharing={sharing}>
      {sharing && <div className="meeting-shared-screen">
        <div className="meeting-share-label"><MonitorUp aria-hidden />{t("landing.meeting.sharedBy")}</div>
        <div className="meeting-shared-plan">
          <span>{t("landing.studio.productTeam")}</span>
          <h3>{t("landing.meeting.planTitle")}</h3>
          <p>{t("landing.meeting.planDescription")}</p>
          <ol>{["brief", "design", "launch"].map((key, index) => <li key={key}>
            <span className="meeting-agenda-number">{index === 0 ? <Check aria-hidden /> : `0${index + 1}`}</span>
            <span>{t(`landing.studio.task_${key}`)}</span><span className="preview-avatar">{PEOPLE[index]!.initials}</span>
          </li>)}</ol>
          <div className="meeting-plan-progress" aria-hidden><span /></div>
        </div>
      </div>}
      <div className="meeting-participants" aria-label={t("landing.meeting.people")}>
        {PEOPLE.map(({ name, initials }, index) => <div className="meeting-participant" key={name} data-self={index === 2} data-camera={index === 2 && camera ? "on" : "off"}>
          <span className="meeting-person-avatar" aria-hidden>{initials}</span>
          {index === 2 && camera && <span className="meeting-camera-simulation"><Video aria-hidden />{t("landing.meeting.cameraPreview")}</span>}
          <div><span>{index === 2 ? t("landing.meeting.you") : name}</span>{index === 0 || (index === 2 && mic) ? <Radio aria-hidden /> : <MicOff aria-hidden />}</div>
        </div>)}
      </div>
    </div>
    <div className="meeting-controls" aria-label={t("landing.meeting.controls")}>
      {controls.map(({ key, icon: Icon, active, action }) => <button key={key} type="button" onClick={action} aria-pressed={active} aria-label={t(`landing.meeting.${key}`)}>
        <Icon aria-hidden /><span>{t(`landing.meeting.${key}`)}</span>
      </button>)}
      <button type="button" onClick={() => setPeople(!people)} aria-expanded={people} aria-controls="meeting-demo-people" aria-label={t("landing.meeting.people")}><UsersRound aria-hidden /><span>{t("landing.meeting.people")}</span></button>
    </div>
    {people && <div id="meeting-demo-people" className="meeting-people-panel">
      <div><strong>{t("landing.meeting.inRoom")}</strong><ul>{PEOPLE.map(({ name }) => <li key={name}>{name}</li>)}</ul></div>
      <div><strong>{t("landing.meeting.waitingRoom")}</strong><p>{t("landing.meeting.waitingDescription")}</p></div>
    </div>}
    <p className="meeting-local-note">{t("landing.meeting.localNote")}</p>
  </figure>;
}
