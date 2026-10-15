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
import { shareDocument } from "@uniwork/core/api/endpoints/documents-sharing";
import { useOptionalWS } from "@uniwork/core/realtime";
import { commentsChangedDocument, frameCanShareView, frameCommentsLevel } from "./frame-comments-events";

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
  /** The document the page opened; a claim held across a detach is only good for this one. */
  documentId: string;
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
   * page keeps the UniWork panel. A re-key of the same document (retry, new revision) keeps
   * the last answer until the next ack, so the page panel does not flash in between.
   */
  framePanel: boolean;
}

interface Attached {
  /** The page's document when the frame shook hands. */
  documentId: string;
  host: DocsFrameHost;
  scope: () => string;
  enabled: boolean;
}

/** The last answer of a frame that detached, kept for its document until the next ack. */
interface Held {
  documentId: string;
  enabled: boolean;
}

/**
 * An HTTP failure (ApiError, with the server's code) or anything else thrown, as the protocol error the frame reads.
 * The §9 table has no 405 row and the anchors route exists, so a 405 is a genuine anomaly: it falls through to the
 * table's default `internal`, never a special `unsupported` the frame would read as "this host lacks the capability".
 */
function toFrameError(error: unknown): DocsProtocolError {
  if (error instanceof DocsProtocolError) return error;
  if (error instanceof ApiError) {
    const mapped = commentsErrorFromHttp(error.status, { error: { code: error.code, message: error.message } });
    // The table maps every 403 (`forbidden`, `break_glass_required`, `document_restricted`) to `forbidden`
    // without the server's code; keep it as `details.code` so the frame can tell a restricted document
    // (panel goes to its no-access state) from a write it may not do.
    if (error.status === 403 && error.code && mapped.details === undefined) {
      return new DocsProtocolError({ code: mapped.code, message: mapped.message, status: 403, retryable: false, details: { code: error.code } });
    }
    return mapped;
  }
  return toProtocolError(error);
}

const malformed = (endpoint: string) =>
  new DocsProtocolError({ code: "internal", message: `${endpoint}: response did not match the contract`, retryable: true });

export function useFrameComments(options: UseFrameCommentsOptions): FrameComments {
  const { wsId, documentId, revealCommentId = null } = options;
  const ws = useOptionalWS();
  const client = ws?.client ?? null;
  const [attached, setAttached] = useState<Attached | null>(null);
  const [held, setHeld] = useState<Held | null>(null);
  const userId = useAuthStore((s) => s.user?.id ?? "");
  const latest = useRef({ options, attached, userId });
  latest.current = { options, attached, userId };
  // One Idempotency-Key per Send, kept across the retries of that Send: the same payload that
  // has not succeeded yet reuses its key, so a create the server already stored is not stored twice.
  // Keyed by payload so two Sends in flight (two threads sent quickly) each keep their own.
  const pendingCreates = useRef<Map<string, string>>(new Map());
  // Whether the last `init` advertised `commentsShareView`; the handler refuses without it (a frame
  // that skips the capability check gets `forbidden`, not a share).
  const shareViewGranted = useRef(false);

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
          const pending = pendingCreates.current;
          const key = pending.get(fingerprint) ?? globalThis.crypto.randomUUID();
          pending.set(fingerprint, key);
          const created = await createFrameComment(doc, payload, { idempotencyKey: key, signal });
          if (created) pending.delete(fingerprint);
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
      // G8-18: grants `view` and nothing else, to a user the frame names; the level is fixed here so a
      // frame can never ask for more. Errors (403 / break_glass_required, 422, 409) take the shared table.
      "comments.shareView": ({ user_id: userId }, { signal }) =>
        call("comments.shareView", async (doc) => {
          if (!shareViewGranted.current) throw new DocsProtocolError({ code: "forbidden", message: "comments.shareView was not granted", retryable: false });
          const shared = await shareDocument(doc, { principal_type: "user", principal_id: userId, level: "view" }, signal);
          return shared ? { ok: true as const } : null;
        }),
      "mentions.search": (payload, { signal }) =>
        call("mentions.search", async (doc) => (await searchFrameMentionCandidates(doc, payload, signal)) as FrameRequests["mentions.search"]["result"] | null),
    };
    return {
      augmentInit(init, { canEdit, readonly }) {
        const level: CommentsLevel = frameCommentsLevel({ myLevel: latest.current.options.myLevel, readonly, canEdit });
        const capabilities: Capabilities = { ...init.capabilities, comments: true };
        shareViewGranted.current = frameCanShareView(level, readonly);
        if (shareViewGranted.current) capabilities.commentsShareView = true;
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
        setHeld(null);
        setAttached({ documentId: latest.current.options.documentId, host, scope, enabled: ack.capabilities.comments === true });
      },
      detach() {
        pendingCreates.current.clear();
        // Keep the answer for the document the frame shook hands for; the next ack replaces it,
        // and a page that moved to another document (or an unmount) does not inherit it.
        const gone = latest.current.attached;
        setHeld(gone ? { documentId: gone.documentId, enabled: gone.enabled } : null);
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

  const framePanel = attached ? attached.enabled : held?.documentId === documentId && held.enabled;
  return { binding, framePanel };
}
