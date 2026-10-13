"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ApiError } from "@uniwork/core/api/http";
import { useAuthStore } from "@uniwork/core/auth";
import {
  createFrameComment,
  deleteFrameComment,
  listFrameCommentRevisions,
  listFrameComments,
  putFrameCommentAnchors,
  reopenFrameComment,
  resolveFrameComment,
  searchFrameMentionCandidates,
  updateFrameComment,
} from "@uniwork/core/api/endpoints/frame-comments";
import type { DocsFrameHost, ApiHandlers } from "@uniwork/core/office/docs-frame-host";
import {
  DocsProtocolError,
  commentsErrorFromHttp,
  toProtocolError,
  type Capabilities,
  type CommentsLevel,
  type FrameRequests,
  type InitAck,
  type InitPayload,
} from "@uniwork/core/office/docs-frame-protocol";
import { useOptionalWS } from "@uniwork/core/realtime";
import { commentsChangedDocument, frameCommentsLevel } from "./frame-comments-events";

// Frame comments (G8-08, contract-collab §7, §9, §10): the host half of the editor's
// `comments.*` protocol, kept out of use-docs-frame-session.ts so that seam stays small. The
// hook builds one binding the session plugs in (four hooks into its handshake and teardown);
// everything else lives here: advertising the capability, answering the frame's requests
// with the user's own session, telling the frame when comments changed, and revealing a
// deep-linked comment once the frame is ready.

type CommentsRequestKey = Extract<keyof ApiHandlers, `comments.${string}` | "mentions.search">;

/** What the frame session needs from comments: its four seams. */
export interface FrameCommentsBinding {
  /** `init` as the session built it, plus the capability, the level and the user id. */
  augmentInit(
    init: Omit<InitPayload, "protocolVersion">,
    session: { canEdit: boolean | undefined; readonly: boolean },
  ): Omit<InitPayload, "protocolVersion">;
  /** The frame's `comments.*` / `mentions.search` requests. */
  api: Pick<ApiHandlers, CommentsRequestKey>;
  /** A handshake completed: `scope` names the document the frame edits right now. */
  attach(host: DocsFrameHost, ack: InitAck, scope: () => string): void;
  /** The frame endpoint is gone (retry, unmount). */
  detach(): void;
}

interface UseFrameCommentsOptions {
  wsId: string;
  /** The document's effective level for the user (`my_level`); absent = decided from the token. */
  myLevel?: string | null;
  /** The comment a deep link names (`?comment=`); revealed once per open and per change of it. */
  revealCommentId?: string | null;
}

interface FrameComments {
  binding: FrameCommentsBinding;
  /**
   * The frame answered `init` with `comments`: its panel is the one comments panel of this
   * page. False until a handshake says so, and with a frame that predates comments, so the
   * page keeps the UniWork panel.
   */
  framePanel: boolean;
}

interface Attached {
  host: DocsFrameHost;
  scope: () => string;
  enabled: boolean;
}

/** An HTTP failure (ApiError, with the server's code) or anything else thrown, as the protocol error the frame reads. */
function toFrameError(error: unknown): DocsProtocolError {
  if (error instanceof DocsProtocolError) return error;
  if (error instanceof ApiError) {
    return commentsErrorFromHttp(error.status, { error: { code: error.code, message: error.message } });
  }
  return toProtocolError(error);
}

const malformed = (endpoint: string) =>
  new DocsProtocolError({ code: "internal", message: `${endpoint}: response did not match the contract`, retryable: true });

export function useFrameComments(options: UseFrameCommentsOptions): FrameComments {
  const { wsId, revealCommentId = null } = options;
  const ws = useOptionalWS();
  const client = ws?.client ?? null;
  const [attached, setAttached] = useState<Attached | null>(null);
  const userId = useAuthStore((s) => s.user?.id ?? "");
  const latest = useRef({ options, attached, userId });
  latest.current = { options, attached, userId };
  // One Idempotency-Key per Send, kept across the retries of that Send: the same payload that
  // has not succeeded yet reuses its key, so a create the server already stored is not stored twice.
  const pendingCreate = useRef<{ fingerprint: string; key: string } | null>(null);

  const binding = useMemo<FrameCommentsBinding>(() => {
    const scope = (): string => {
      const current = latest.current.attached;
      if (!current) throw new DocsProtocolError({ code: "cancelled", message: "the editor frame is gone" });
      return current.scope();
    };
    /** Runs one request against the document the frame edits and maps what goes wrong. */
    const call = async <T,>(endpoint: string, run: (documentId: string) => Promise<T | null>): Promise<T> => {
      try {
        const result = await run(scope());
        if (result === null) throw malformed(endpoint);
        return result;
      } catch (error) {
        throw toFrameError(error);
      }
    };
    const api: FrameCommentsBinding["api"] = {
      "comments.list": (payload, { signal }) =>
        call("comments.list", async (doc) => {
          const list = await listFrameComments(doc, payload, signal);
          if (!list) return null;
          // An unchanged answer is the token alone: the frame keeps the list it holds.
          const full = list.unchanged ? { comments: [], mentions: [], list_token: list.list_token, unchanged: true } : list;
          return full as FrameRequests["comments.list"]["result"];
        }),
      "comments.create": (payload, { signal }) =>
        call("comments.create", async (doc) => {
          const fingerprint = JSON.stringify(payload);
          const same = pendingCreate.current?.fingerprint === fingerprint;
          const key = same && pendingCreate.current ? pendingCreate.current.key : globalThis.crypto.randomUUID();
          pendingCreate.current = { fingerprint, key };
          const created = await createFrameComment(doc, payload, { idempotencyKey: key, signal });
          if (created) pendingCreate.current = null;
          return created as FrameRequests["comments.create"]["result"] | null;
        }),
      "comments.update": ({ comment_id: id, body }, { signal }) =>
        call("comments.update", async (doc) => (await updateFrameComment(doc, id, { body }, signal)) as FrameRequests["comments.update"]["result"] | null),
      "comments.delete": ({ comment_id: id }, { signal }) =>
        call("comments.delete", (doc) => deleteFrameComment(doc, id, signal)),
      "comments.resolve": ({ comment_id: id }, { signal }) =>
        call("comments.resolve", async (doc) => (await resolveFrameComment(doc, id, signal)) as FrameRequests["comments.resolve"]["result"] | null),
      "comments.reopen": ({ comment_id: id }, { signal }) =>
        call("comments.reopen", async (doc) => (await reopenFrameComment(doc, id, signal)) as FrameRequests["comments.reopen"]["result"] | null),
      "comments.revisions": ({ comment_id: id }, { signal }) =>
        call("comments.revisions", async (doc) => (await listFrameCommentRevisions(doc, id, signal)) as FrameRequests["comments.revisions"]["result"] | null),
      "comments.anchors": (payload, { signal }) =>
        call("comments.anchors", async (doc) => (await putFrameCommentAnchors(doc, payload, signal)) as FrameRequests["comments.anchors"]["result"] | null),
      "mentions.search": (payload, { signal }) =>
        call("mentions.search", async (doc) => (await searchFrameMentionCandidates(doc, payload, signal)) as FrameRequests["mentions.search"]["result"] | null),
    };
    return {
      augmentInit(init, { canEdit, readonly }) {
        const level: CommentsLevel = frameCommentsLevel({ myLevel: latest.current.options.myLevel, readonly, canEdit });
        const capabilities: Capabilities = { ...init.capabilities, comments: true };
        // `id` is for "my comments" in the frame, never an authorization; the display name is the session's.
        const id = latest.current.userId;
        return {
          ...init,
          capabilities,
          commentsLevel: level,
          ...(id ? { user: { displayName: init.user?.displayName ?? "", id } } : {}),
        };
      },
      api,
      attach(host, ack, scope) {
        setAttached({ host, scope, enabled: ack.capabilities.comments === true });
      },
      detach() {
        pendingCreate.current = null;
        setAttached(null);
      },
    };
  }, []);

  // Realtime frames for this document become `comments.changed`; frames are ids-only and the
  // frame re-lists on its own.
  useEffect(() => {
    if (!attached?.enabled || !client) return undefined;
    return client.onAny((message) => {
      const changed = commentsChangedDocument(message, wsId, attached.scope());
      if (changed) attached.host.notifyCommentsChanged(changed);
    });
  }, [attached, client, wsId]);

  // A deep link: reveal once per open of the document and per change of the link, and only
  // when the frame has comments (otherwise the page's own panel takes the link).
  // Keyed by the handshake (each `attach` is a new open, a reloaded frame included), not by the host.
  const revealed = useRef<{ open: Attached; id: string } | null>(null);
  useEffect(() => {
    if (!attached?.enabled || !revealCommentId) return;
    if (revealed.current?.open === attached && revealed.current.id === revealCommentId) return;
    revealed.current = { open: attached, id: revealCommentId };
    // The host retries once on its own; a second failure is the frame's panel to show.
    void attached.host.revealComment(revealCommentId).catch(() => undefined);
  }, [attached, revealCommentId]);

  return { binding, framePanel: attached?.enabled === true };
}
