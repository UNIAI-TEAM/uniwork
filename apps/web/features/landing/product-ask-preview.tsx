"use client";

import { useContext, useState, type ReactNode, type RefCallback } from "react";
import { createPortal } from "react-dom";
import { MessageSquarePlus, Send, Sparkles, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { IconTile } from "@uniwork/ui/components/common/icon-tile";
import { Button } from "@uniwork/ui/components/ui/button";
import { Textarea } from "@uniwork/ui/components/ui/textarea";
import { Spinner } from "@uniwork/ui/components/ui/spinner";
import { AskUniMessageTurn } from "@uniwork/views/ai/ask-uni-panel";
import { ProductDemoPlaybackSlot } from "./product-demo-playback-slot";
import { ProductDemoNavigation } from "./product-demo-navigation";
import { DEMO_PEOPLE } from "./product-task-data";
import { ProductTaskScene } from "./product-task-scene";

export function ProductAskPreview({ step, control, cursor, stageRef, label, onTask }: { step?: number; control?: ReactNode; cursor?: ReactNode; stageRef?: RefCallback<HTMLDivElement>; label?: string; onTask?: () => void }) {
  const { t } = useTranslation();
  const controlSlot = useContext(ProductDemoPlaybackSlot);
  const [draft, setDraft] = useState("");
  const [question, setQuestion] = useState("");
  const [source, setSource] = useState(false);
  const movie = step !== undefined;
  const asked = movie ? step > 0 : !!question;
  const waiting = movie && step === 1;
  const showSource = movie ? step === 3 : source;
  const ask = (text: string) => { if (text.trim()) { setQuestion(text.trim()); setDraft(""); } };
  return <div className="product-ask-preview">
    {control && (controlSlot ? createPortal(control, controlSlot) : <div className="product-email-inline-controls">{control}</div>)}
    <div ref={stageRef} className="product-ask-stage" role={movie ? "img" : undefined} aria-label={label}>
      <div className="product-ask-scene" inert={movie || undefined} aria-hidden={movie || undefined}>
        <div className="product-ask-context" aria-hidden><ProductTaskScene step={showSource ? 1 : 0} /></div>
        <ProductDemoNavigation onOpen={() => { if (onTask) onTask(); else setSource(true); }}><section className="product-ask-panel" aria-label={t("ai.title")}>
          <header><IconTile icon={Sparkles} tone="violet" size="sm" /><h2>{t("ai.title")}</h2><Button size="icon" variant="ghost" aria-label={t("ai.new_conversation")} onClick={() => { setQuestion(""); setSource(false); }}><MessageSquarePlus aria-hidden /></Button><Button size="icon" variant="ghost" aria-label={t("common.delete")} onClick={() => { setQuestion(""); setSource(false); }}><Trash2 aria-hidden /></Button></header>
          <div className="product-ask-turns">{!asked ? <div className="flex flex-col items-center gap-6 pt-6 text-center"><IconTile icon={Sparkles} tone="violet" size="lg" /><div className="max-w-[40ch]"><p className="text-body font-semibold">{t("ai.empty_title")}</p><p className="mt-1 text-caption text-muted-foreground">{t("ai.empty_description")}</p></div><div className="flex flex-wrap justify-center gap-2">{["suggestion_overdue", "suggestion_meetings", "suggestion_chat"].map(key => <Button key={key} variant="outline" size="sm" onClick={() => ask(t(`ai.${key}`))}>{t(`ai.${key}`)}</Button>)}</div></div> : <ul className="space-y-4" aria-live="polite"><AskUniMessageTurn message={{ id: "demo-question", role: "user", content: movie ? t("landing.demo.ownerQuestion") : question, citations: [] }} />{waiting ? <li className="action-pending flex items-center gap-2 text-caption text-muted-foreground"><Spinner className="size-4" />{t("ai.asking")}</li> : <li data-demo-target="ask-source"><ul><AskUniMessageTurn message={{ id: "demo-answer", role: "assistant", content: t("landing.productDemo.taskOwnerAnswer", { name: DEMO_PEOPLE.TN, task: t("landing.productDemo.board.tasks.design") }), citations: [{ source_id: "S1", kind: "task", title: t("landing.productDemo.board.tasks.design"), quote: "", href: "/tasks/UNI-18" }] }} /></ul></li>}</ul>}</div>
          <form className="product-ask-composer" onSubmit={event => { event.preventDefault(); ask(draft); }}><Textarea value={movie && step === 0 ? t("landing.demo.ownerQuestion") : draft} onChange={event => setDraft(event.target.value)} placeholder={t("ai.placeholder")} aria-label={t("ai.placeholder")} rows={2} onKeyDown={event => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); ask(draft); } }} /><div><span>{t("landing.lovable.sample")}</span><Button type="submit" size="icon" aria-label={t("ai.ask")} disabled={!movie && !draft.trim()} data-demo-target="ask-send"><Send aria-hidden /></Button></div></form>
        </section></ProductDemoNavigation>
      </div>{cursor}
    </div>
  </div>;
}
