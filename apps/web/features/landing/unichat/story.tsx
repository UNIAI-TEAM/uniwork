"use client";
import { Bell, Bookmark, ChevronDown, Folder, Hash, Phone } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@uniwork/ui/lib/utils";
import { Container } from "../layout-primitives";
import { AppPill } from "../apps/app-sections";
import { DEMO_MEMBERS } from "../product-demo-data";

const [MAI_AN, AN_NHIEN, KHANH_VY, , GIA_MINH] = DEMO_MEMBERS;
const STEPS = ["task", "project", "followUp", "call"] as const;
type Step = typeof STEPS[number];
const ALSO = ["voice", "poll", "stickers", "threads", "pins", "search"] as const;

function StepStage({ step }: { step: Step }) {
  const { t } = useTranslation();
  const s = (key: string) => t(`landing.unichat.story.stage.${key}`);
  if (step === "task") return <div className="uc-sp">
    <div className="uc-panel"><div className="uc-panel-wall">
      <div className="uc-in"><span className="uc-av is-online">{KHANH_VY!.initials}</span><div><div className="uc-bubble"><b className="uc-sender is-1">{KHANH_VY!.name}</b><p>{t("landing.unichat.stage.messages.ask")}</p></div><time>09:12</time></div></div>
    </div></div>
    <div className="uc-dialog">
      <b className="uc-dialog-title">{s("dialogTitle")}</b>
      <span className="uc-field"><small>{s("titleField")}</small><span className="is-focus">{t("landing.unichat.stage.task")}</span></span>
      <span className="uc-field"><small>{s("projectField")}</small><span>{s("project")}<ChevronDown /></span></span>
      <span className="uc-dialog-actions"><span>{s("cancel")}</span><span className="is-primary">{s("create")}</span></span>
    </div>
  </div>;
  if (step === "project") return <div className="uc-sp"><div className="uc-panel">
    <div className="uc-panel-head"><span className="uc-mark"><Hash /></span><span><b>{t("landing.unichat.stage.channel")}</b><small>{t("landing.unichat.stage.members")}</small></span><span className="uc-project"><Folder />{s("project")}</span></div>
    <div className="uc-panel-wall">
      <span className="uc-day is-start">{s("projectTasks")}</span>
      {([["DEMO-108", "t108", "done", KHANH_VY], ["DEMO-111", "t111", "doing", MAI_AN], ["DEMO-114", "t114", "todo", AN_NHIEN]] as const).map(([id, title, status, owner]) => <span key={id} className="uc-trow"><span className="uc-task-id">{id}</span><span className="uc-trow-title">{s(title)}</span><span className={`uc-status is-${status}`}>{s(status)}</span><span className="uc-av is-small">{owner!.initials}</span></span>)}
    </div>
  </div></div>;
  if (step === "followUp") return <div className="uc-sp">
    <div className="uc-panel"><div className="uc-panel-wall"><div className="uc-reminder"><span><Bell />{s("reminder")}</span><p>{s("reminderBody")}</p></div></div></div>
    <div className="uc-panel">
      <div className="uc-panel-head"><Bookmark /><b>{s("followUps")}</b><span className="uc-count">2</span></div>
      <div className="uc-fus">
        <span className="uc-fu"><span className="uc-av is-small">{GIA_MINH!.initials}</span><span>{s("fu1")}</span><em>{s("fu1When")}</em></span>
        <span className="uc-fu"><span className="uc-av is-small">{KHANH_VY!.initials}</span><span>{s("fu2")}</span><em>{s("fu2When")}</em></span>
      </div>
    </div>
  </div>;
  return <div className="uc-sp">
    <div className="uc-callrow"><span className="uc-call-icon"><Phone /></span><span><b>{s("call")}</b><small>{s("callMeta")}</small></span></div>
    <div className="uc-summary">
      <span className="uc-summary-head"><span className="uc-ai">AI</span><b>{s("summary")}</b><small>{s("summaryMeta")}</small></span>
      <ul><li>{s("s1")}</li><li>{s("s2")}</li><li>{s("s3")}</li></ul>
    </div>
  </div>;
}

/**
 * What the chat does for the work, told in four steps beside one stage. The
 * stage follows the reader's scroll on a wide screen and the chosen step
 * everywhere; on a phone it sits above the steps.
 */
export function UniChatStory() {
  const { t } = useTranslation();
  const [active, setActive] = useState<Step>("task");
  const list = useRef<HTMLOListElement>(null);
  useEffect(() => {
    if (typeof IntersectionObserver === "undefined" || !list.current) return;
    const observer = new IntersectionObserver((entries) => {
      const hit = entries.find((entry) => entry.isIntersecting);
      const step = hit?.target.getAttribute("data-step") as Step | null | undefined;
      if (step) setActive(step);
    }, { rootMargin: "-45% 0px -45% 0px" });
    list.current.querySelectorAll("[data-step]").forEach((element) => observer.observe(element));
    return () => observer.disconnect();
  }, []);
  return <section id="unichat-features" className="app-section" aria-labelledby="unichat-features-title">
    <Container>
      <div className="app-section-head">
        <AppPill>{t("landing.unichat.story.eyebrow")}</AppPill>
        <h2 id="unichat-features-title" className="app-h2">{t("landing.unichat.story.title")}</h2>
        <p className="app-lead">{t("landing.unichat.story.sub")}</p>
      </div>
      <div className="uc-story">
        <div className="uc-story-stage"><div className="uc-sstage" aria-hidden><StepStage key={active} step={active} /></div></div>
        <ol ref={list} className="uc-steps">
          {STEPS.map((step, index) => <li key={step} data-step={step} className={cn("uc-step", active === step && "is-on")}>
            <h3><button type="button" aria-pressed={active === step} onClick={() => setActive(step)}><span className="uc-step-n">{String(index + 1).padStart(2, "0")}</span>{t(`landing.unichat.story.${step}.title`)}</button></h3>
            <p>{t(`landing.unichat.story.${step}.body`)}</p>
          </li>)}
        </ol>
      </div>
      <div className="uc-also"><span>{t("landing.unichat.story.also.label")}</span><ul>{ALSO.map((key) => <li key={key}>{t(`landing.unichat.story.also.${key}`)}</li>)}</ul></div>
    </Container>
  </section>;
}
