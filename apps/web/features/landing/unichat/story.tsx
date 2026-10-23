"use client";
import { Bell, Bookmark, ChevronDown, ChevronRight, Folder, Hash, ListChecks, Phone, type LucideIcon } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Container } from "../layout-primitives";
import { DEMO_MEMBERS } from "../product-demo-data";

const [MAI_AN, AN_NHIEN, KHANH_VY, , GIA_MINH] = DEMO_MEMBERS;
const STEPS = ["task", "project", "followUp", "call"] as const;
type Step = typeof STEPS[number];
const ICONS: Record<Step, LucideIcon> = { task: ListChecks, project: Folder, followUp: Bell, call: Phone };
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
 * What the chat does for the work: four features to pick from beside one
 * stage, the way the home page's "your team's way of working" chapter picks
 * an audience. On a narrow screen the stage sits above the list.
 */
export function UniChatStory() {
  const { t } = useTranslation();
  const [active, setActive] = useState<Step>("task");
  return <section id="unichat-features" className="app-section" aria-labelledby="unichat-features-title">
    <Container>
      <div className="app-section-head">
        <h2 id="unichat-features-title" className="app-h2">{t("landing.unichat.story.title")}</h2>
        <p className="app-lead">{t("landing.unichat.story.sub")}</p>
      </div>
      <div className="uc-showcase">
        <div className="uc-picks">
          {STEPS.map((step) => {
            const Icon = ICONS[step];
            return <button key={step} type="button" className="uc-pick" data-step={step} aria-pressed={active === step} aria-controls="unichat-feature-stage" onClick={() => setActive(step)}>
              <span className="uc-pick-icon"><Icon aria-hidden /></span>
              <span className="uc-pick-copy"><strong>{t(`landing.unichat.story.${step}.title`)}</strong><small>{t(`landing.unichat.story.${step}.body`)}</small></span>
              <ChevronRight aria-hidden className="uc-pick-chevron" />
            </button>;
          })}
        </div>
        <div id="unichat-feature-stage" className="uc-preview" data-step={active} aria-hidden><StepStage key={active} step={active} /></div>
      </div>
      <div className="uc-also"><span>{t("landing.unichat.story.also.label")}</span><ul>{ALSO.map((key) => <li key={key}>{t(`landing.unichat.story.also.${key}`)}</li>)}</ul></div>
    </Container>
  </section>;
}
