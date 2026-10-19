"use client";

import { useEffect, useRef, useState } from "react";
import type { ChatMessage } from "./chat-messages";
import { useFreshChatMediaUrl } from "./use-chat-media-url";

type PdfFirstPage = { pages: number; src: string };

type ChatPdfPreview =
  | { status: "idle" | "loading" | "error" }
  | ({ status: "ready" } & PdfFirstPage);

/** Above this a PDF draws its first page only once someone opens the preview. */
const CHAT_PDF_AUTO_PREVIEW_MAX_BYTES = 10 * 1024 * 1024;
const CACHE_MAX = 40;

/**
 * First pages by message (a file message carries exactly one file): a card the
 * virtual list mounts again shows its page count and preview at once, and a
 * PDF is read once per session. A failure is not kept, so the next mount tries
 * again.
 */
const pending = new Map<string, Promise<PdfFirstPage>>();
const firstPages = new Map<string, PdfFirstPage>();

function remember(id: string, page: PdfFirstPage) {
  firstPages.set(id, page);
  if (firstPages.size > CACHE_MAX) firstPages.delete(firstPages.keys().next().value as string);
}

/**
 * A PDF message's page count and first-page picture. Reading starts when the
 * card scrolls into view (a PDF up to CHAT_PDF_AUTO_PREVIEW_MAX_BYTES) or when
 * `wanted` (its preview is open); until then nothing is fetched.
 */
export function useChatPdfPreview(workspaceId: string, roomId: string, message: ChatMessage, wanted: boolean) {
  const freshUrl = useFreshChatMediaUrl(workspaceId, roomId);
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [result, setResult] = useState<PdfFirstPage | "error" | null>(() => firstPages.get(message.id) ?? null);
  const small = (message.file?.size_bytes ?? 0) <= CHAT_PDF_AUTO_PREVIEW_MAX_BYTES;
  const start = wanted || (visible && small);

  useEffect(() => {
    const node = ref.current;
    if (!node || visible || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) setVisible(true);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [visible]);

  const id = message.id;
  const url = message.file?.url;
  const expiresAt = message.file?.url_expires_at;
  useEffect(() => {
    if (!start || firstPages.has(id)) return;
    let live = true;
    let job = pending.get(id);
    if (!job) {
      job = freshUrl(id, { url, expiresAt }, (fresh) => fresh.file?.url)
        .then((href) => import("./chat-pdf-render").then((render) => render.renderChatPdfFirstPage(href)))
        .then((page) => {
          remember(id, page);
          return page;
        })
        .finally(() => pending.delete(id));
      pending.set(id, job);
    }
    job.then(
      (page) => live && setResult(page),
      () => live && setResult("error"),
    );
    return () => {
      live = false;
    };
  }, [expiresAt, freshUrl, id, start, url]);

  const preview: ChatPdfPreview =
    result === "error"
      ? { status: "error" }
      : result
        ? { status: "ready", ...result }
        : start
          ? { status: "loading" }
          : { status: "idle" };
  return { ref, preview };
}
