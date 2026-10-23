import { Check, FileText, MessageSquare, Paperclip, Search, Sparkles, UserRound } from "lucide-react";
import { useTranslation } from "react-i18next";
import "./business-os-preview.css";

type PreviewKind = "projects" | "word" | "gateway" | "chat";

function Avatar({ tone = "blue" }: { tone?: string }) {
  return <span className="os-preview-avatar" data-tone={tone}><UserRound /></span>;
}

export function BusinessOsPreview({ kind }: { kind: PreviewKind }) {
  const { t } = useTranslation();
  const copy = (key: string) => t(`landing.businessOs.preview.${key}`);
  return <span className="os-preview" data-preview={kind} aria-hidden="true">
    {kind === "projects" && <span className="os-preview-board">
      <span className="os-preview-column">
        <span className="os-preview-column-title"><span />{copy("todo")}</span>
        <span className="os-preview-task"><span className="os-preview-task-art"><span /><span /><span /></span>
          <strong>{copy("design")}</strong><span className="os-preview-task-meta"><Avatar /><Paperclip /></span></span>
      </span>
      <span className="os-preview-column">
        <span className="os-preview-column-title"><span />{copy("inProgress")}</span>
        <span className="os-preview-task os-preview-moving-task"><span className="os-preview-check"><Check /></span>
          <strong>{copy("content")}</strong><span className="os-preview-task-lines"><i /><i /></span>
          <span className="os-preview-task-meta"><span><Avatar tone="violet" /><Avatar tone="green" /></span><MessageSquare /></span></span>
      </span>
    </span>}
    {kind === "word" && <span className="os-preview-documents">
      <span className="os-preview-sheet os-preview-sheet-back"><FileText /></span>
      <span className="os-preview-sheet os-preview-sheet-middle"><span /><span /><span /></span>
      <span className="os-preview-sheet os-preview-sheet-front"><span className="os-preview-doc-label">{copy("brief")}</span>
        <strong>{copy("launch")}</strong><span className="os-preview-doc-people"><Avatar /><Avatar tone="violet" /><Avatar tone="green" /></span>
        <span className="os-preview-doc-heading">{copy("objective")}</span><span className="os-preview-doc-text">{copy("together")}</span>
        <span className="os-preview-doc-lines"><i /><i /><i /></span><span className="os-preview-doc-highlight" /></span>
    </span>}
    {kind === "gateway" && <span className="os-preview-ai">
      <span className="os-preview-question"><Search />{copy("question")}</span>
      <span className="os-preview-answer"><span className="os-preview-spark"><Sparkles /></span><span><strong>{copy("launch")}</strong>
        <span className="os-preview-answer-lines"><i /><i /></span></span></span>
      <span className="os-preview-context"><span><FileText />{copy("brief")}</span><span><Check />{copy("task")}</span><span><MessageSquare />{copy("conversation")}</span></span>
    </span>}
    {kind === "chat" && <span className="os-preview-chat">
      <span className="os-preview-message"><Avatar tone="green" /><span><strong>{copy("designReady")}</strong><span className="os-preview-chat-attachment"><FileText />{copy("launch")}</span></span></span>
      <span className="os-preview-message os-preview-reply"><Avatar tone="violet" /><span>{copy("reviewTogether")}<span className="os-preview-reactions"><Check /><span /><span /></span></span></span>
      <span className="os-preview-chat-input"><span>{copy("message")}</span><Paperclip /><span className="os-preview-send"><Check /></span></span>
    </span>}
  </span>;
}
