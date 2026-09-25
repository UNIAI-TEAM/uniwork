"use client";
import { CalendarDays, Check, ChevronLeft, ChevronRight, Columns3, Flag, Video } from "lucide-react";
import { useTranslation } from "react-i18next";

/** A labelled design reference, not a live calendar or a claim of availability. */
export function CalendarReference() {
  const { t } = useTranslation();
  // Explicit labels avoid ICU differences between Node and browser hydration.
  const weekdays = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
  const events = [{ day: 7, type: "meeting", text: "sync", time: "09:30" }, { day: 9, type: "task", text: "design", time: "14:00" }, { day: 14, type: "meeting", text: "sync", time: "09:30" }, { day: 16, type: "deadline", text: "review", time: "16:00" }, { day: 21, type: "meeting", text: "sync", time: "09:30" }, { day: 23, type: "task", text: "design", time: "14:00" }, { day: 25, type: "deadline", text: "launch", time: "17:00" }];
  return <div className="reference-calendar" role="img" aria-label={t("landing.reference.calendarAlt")}>
    <aside><strong><CalendarDays />{t("landing.reference.month")}</strong><p>{t("landing.reference.calendarScope")}</p><div>{[{ key: "meeting", icon: Video }, { key: "task", icon: Columns3 }, { key: "deadline", icon: Flag }].map(({ key, icon: Icon }) => <span key={key}><Check /><Icon />{t(`landing.reference.${key}`)}</span>)}</div></aside>
    <div className="reference-calendar-main"><header><strong>{t("landing.reference.month")}</strong><span><ChevronLeft /><ChevronRight /></span></header><div className="reference-weekdays">{weekdays.map(day => <span key={day}>{t(`landing.reference.weekdays.${day}`)}</span>)}</div><div className="reference-month-grid">{Array.from({ length: 35 }, (_, i) => { const day = i; return <div key={i} data-current={day === 23} data-outside={day < 1 || day > 30}><span>{day < 1 ? 31 : day > 30 ? day - 30 : day}</span>{events.filter(event => event.day === day).map(event => <p key={event.text} data-kind={event.type}><time>{event.time}</time>{t(`landing.reference.events.${event.text}`)}</p>)}</div>; })}</div></div>
  </div>;
}
