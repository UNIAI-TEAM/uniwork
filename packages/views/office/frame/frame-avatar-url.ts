// Comment avatars for the Office frames (UNI-1986). The frame's CSP is `img-src 'self' data: blob:`, so an
// avatar URL the server hands the host (a presigned storage URL or a provider URL) is a CSP violation the
// moment the frame renders it. The host therefore never forwards one: a person with a picture reaches the
// frame as the same-origin route the frame fetches with its frame token and shows as a blob,
// `/api/v1/office-frame/documents/{documentId}/avatars/{userId}` (no query, no host); everyone else
// (an agent, no picture, a frame that does not know the route) gets `""`, which the frame draws as initials.
// The incoming URL is only the signal "has a picture": the route answers one uniform 404 for a person whose
// picture is not a stored file, and the frame falls back to initials on its own.

/**
 * The pinned frame builds (`pinnedFrameVersion(module)`, the `version` of a `*.pin.json`) whose fork bundle
 * loads avatars through the route (fork commit 398c0dd0c, UNI-1986). A build that is not listed gets `""`
 * for every avatar, which also ends the CSP noise today's pins produce. The re-pin to a bundle with the
 * avatar loader adds that build's version string here, and nothing else changes.
 */
export const AVATAR_ROUTE_FRAME_VERSIONS: readonly string[] = [];

/** Whether the frame build `frameVersion` is one that knows the avatar route. */
export function frameKnowsAvatarRoute(frameVersion: string, known: readonly string[] = AVATAR_ROUTE_FRAME_VERSIONS): boolean {
  return frameVersion !== "" && known.includes(frameVersion);
}

/** A ULID: 26 characters of the Crockford alphabet, upper case, exactly as the route's rewrite and handler take it. */
const ULID = /^[0-9A-HJKMNP-TV-Z]{26}$/;

/** What the avatar of one item needs: the document the frame edits and whether this frame knows the route. */
export interface FrameAvatarContext {
  documentId: string;
  /** `frameKnowsAvatarRoute(pinned version)`. */
  routeKnown: boolean;
}

/** The context for one request: the document the frame edits now and the build the page pinned. */
export function frameAvatarContext(documentId: string, frameVersion: string): FrameAvatarContext {
  return { documentId, routeKnown: frameKnowsAvatarRoute(frameVersion) };
}

/** The route path of a person's picture in a document. */
function frameAvatarPath(documentId: string, userId: string): string {
  return `/api/v1/office-frame/documents/${documentId}/avatars/${userId}`;
}

/**
 * The `avatar_url` the frame receives for one person: the route for a human with a picture, `""` otherwise.
 * `kind` is the item's author kind (`human`, `agent`, `system`); an item without a kind (a mention or a
 * candidate, which are always people) passes "human".
 */
export function frameAvatarUrl(
  context: FrameAvatarContext,
  kind: string | undefined,
  userId: string | null | undefined,
  avatarUrl: unknown,
): string {
  if (!context.routeKnown || kind !== "human") return "";
  if (typeof avatarUrl !== "string" || avatarUrl === "") return "";
  if (typeof userId !== "string" || !ULID.test(userId) || !ULID.test(context.documentId)) return "";
  return frameAvatarPath(context.documentId, userId);
}

type Wire = Record<string, unknown>;

/** `item` with `avatar_url` set to `avatarUrl`; an item that carries no `avatar_url` is returned as it is. */
function withAvatar<T extends Wire>(item: T, avatarUrl: string): T {
  return item.avatar_url === avatarUrl ? item : { ...item, avatar_url: avatarUrl };
}

/** A comment as the frame reads it (`DocumentComment`): the author's picture only, every other field untouched. */
function frameComment<T extends Wire>(context: FrameAvatarContext, comment: T): T {
  if (comment.avatar_url === undefined) return comment;
  return withAvatar(comment, frameAvatarUrl(context, str(comment.author_kind), str(comment.author_id), comment.avatar_url));
}

/** A mention of a comment (`CommentMention`, a person: the current name and picture of an id in a mention token). */
function frameMention<T extends Wire>(context: FrameAvatarContext, mention: T): T {
  if (mention.avatar_url === undefined) return mention;
  return withAvatar(mention, frameAvatarUrl(context, mentionKind(mention), str(mention.user_id), mention.avatar_url));
}

/** A `mentions.search` candidate (`MentionCandidate`, always a person). */
function frameCandidate<T extends Wire>(context: FrameAvatarContext, candidate: T): T {
  if (candidate.avatar_url === undefined) return candidate;
  return withAvatar(candidate, frameAvatarUrl(context, mentionKind(candidate), str(candidate.user_id), candidate.avatar_url));
}

const str = (value: unknown): string | undefined => (typeof value === "string" ? value : undefined);

/**
 * Mentions and candidates are people and carry no kind; one that does (a later server) and says it is not a
 * human is not shown a picture.
 */
function mentionKind(item: Wire): string {
  return str(item.kind) ?? str(item.user_kind) ?? "human";
}

/** The `comments.list` answer, picture fields only; an `unchanged` answer carries no rows and passes as it is. */
export function frameCommentList<T extends { comments: Wire[]; mentions: Wire[] }>(context: FrameAvatarContext, list: T): T {
  return {
    ...list,
    comments: list.comments.map((c) => frameComment(context, c)),
    mentions: list.mentions.map((m) => frameMention(context, m)),
  };
}

/** A `{comment}` answer (create, update, resolve, reopen). */
export function frameCommentResult<T extends { comment: Wire }>(context: FrameAvatarContext, result: T): T {
  return { ...result, comment: frameComment(context, result.comment) };
}

/** The `mentions.search` answer. */
export function frameCandidates<T extends { candidates: Wire[] }>(context: FrameAvatarContext, result: T): T {
  return { ...result, candidates: result.candidates.map((c) => frameCandidate(context, c)) };
}
