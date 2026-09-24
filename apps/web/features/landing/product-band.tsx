"use client";
import { useTranslation } from "react-i18next";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@uniwork/ui/components/ui/accordion";
import { WorkflowFilm } from "./workflow-film";
import { MeetingRoom } from "./meeting-room";

/** Meetings are one view inside the shared product stage, not another band. */
export function MeetingPreview() {
  const { t } = useTranslation();
  return <div className="meeting-preview">
    <MeetingRoom />
    <Accordion className="meeting-follow-up">
      <AccordionItem value="after-meeting">
        <AccordionTrigger>{t("landing.meeting.followUp")}</AccordionTrigger>
        <AccordionContent><div className="meeting-follow-up-layout">
          <div><h3>{t("landing.meeting.followUpTitle")}</h3><p>{t("landing.meeting.followUpDescription")}</p><p>{t("landing.updates.meetingPoint3")}</p></div>
          <WorkflowFilm />
        </div></AccordionContent>
      </AccordionItem>
    </Accordion>
  </div>;
}
