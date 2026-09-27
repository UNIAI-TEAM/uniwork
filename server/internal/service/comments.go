package service

// The shared comment core (plan G1-07, UNI-681): task_comments and
// document_comments are two tables behind one engine. A resource plugs in a
// commentAdapter - the persistence half maps validated writes onto its sqlc
// queries and the authorizer half answers "author or resource manager" -
// while every command still enters through the resource's own gate
// (authorizeActor for tasks, withDocumentMutation for documents) and the
// engine runs on the transaction that gate opened. Reactions live in the
// shared comment_reactions table, but a reaction lookup always goes through
// the resource adapter first: the comment id is proven to belong to the
// claimed resource before a row is touched, never by probing tables.
//
// Mention markup is parsed in internal/mentions, not here: the delivery
// rules re-read the comment body at notification time and that package may
// not import service.

import (
	"context"
	"errors"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// CommentResourceKind names which comment table a thread lives in.
type CommentResourceKind string

const (
	CommentResourceTask     CommentResourceKind = "task"
	CommentResourceDocument CommentResourceKind = "document"
)

// CommentRef is the core's resource reference: the kind, the resource id
// and the tenant pair every adapter query filters on.
type CommentRef struct {
	Kind           CommentResourceKind
	ResourceID     string // task_id / document_id
	OrganizationID string
	WorkspaceID    string
}

// --- validation -----------------------------------------------------------

// normalizeCommentBody is the one body rule every resource shares.
func normalizeCommentBody(body string) (string, error) {
	body = strings.TrimSpace(body)
	if body == "" {
		return "", Invalid("nội dung không được để trống")
	}
	return body, nil
}

// normalizeCommentType applies the adapter's allowlist; "" is a plain
// comment. Task threads accept status_change/progress_update/system;
// document comments take "comment" only, so a public client can never write
// a system row there.
func normalizeCommentType(commentType string, allowed []string) (string, error) {
	t := strings.TrimSpace(commentType)
	if t == "" {
		return "comment", nil
	}
	for _, a := range allowed {
		if t == a {
			return t, nil
		}
	}
	return "", Invalid("comment_type không hợp lệ")
}

// commentActorType maps an actor onto the creator_type vocabulary
// (member|agent|system) the reaction and resolve columns use.
func commentActorType(kind audit.Kind) string {
	return normalizedCreatorType(kind)
}

// --- threading ------------------------------------------------------------

// commentIdentity is the normalized view the core needs over a row of
// either table.
type commentIdentity struct {
	ID         string
	ResourceID string // owning task_id / document_id
	AuthorID   string
	AuthorKind string
}

// errCommentParentForeign marks a supplied parent that exists but belongs
// to another resource; the adapter translates it into its own wording.
var errCommentParentForeign = errors.New("comment parent belongs to another resource")

// commentAdapter is the persistence adapter + resource authorizer one
// resource plugs into the core. Every method runs on the transaction it is
// handed, so a command holding the resource lock sees the locked view.
type commentAdapter[C any] interface {
	// byID loads a row by bare id: the entry point for the id-addressed
	// commands, before the resource's gate has vetted the actor.
	byID(ctx context.Context, q *db.Queries, id string) (C, error)
	// tenantGet loads a row inside the tenant pair - the parent check and
	// the in-transaction re-read.
	tenantGet(ctx context.Context, q *db.Queries, ref CommentRef, id string) (C, error)
	// identity projects a row onto the fields the core shares.
	identity(c C) commentIdentity

	insert(ctx context.Context, q *db.Queries, ref CommentRef, in AddCommentInput, p preparedComment) (C, error)
	updateBody(ctx context.Context, q *db.Queries, ref CommentRef, c C, body string) (C, error)
	remove(ctx context.Context, q *db.Queries, ref CommentRef, c C) error
	resolve(ctx context.Context, q *db.Queries, ref CommentRef, c C, resolvedByType, resolvedByID string) (C, error)
	unresolve(ctx context.Context, q *db.Queries, ref CommentRef, c C) (C, error)

	// commentTypes is the allowlist normalizeCommentType applies.
	commentTypes() []string
	// foreignParentError is the Invalid() worded for the resource.
	foreignParentError() error
	// canModerate is "author or resource manager" on this comment; the
	// manager half is resource policy (workspace admin on tasks, the
	// manage level on documents).
	canModerate(ctx context.Context, actor Actor, ref CommentRef, c C) (bool, error)
	// beforeDelete runs inside the delete transaction before the row goes
	// (attachment release on tasks); resources without one return nil.
	beforeDelete(ctx context.Context, q *db.Queries, ref CommentRef, c C) error
	// verbs is the resource's audit-action / outbox-topic vocabulary.
	verbs() commentVerbs
}

// preparedComment is the validated create the adapter maps onto its INSERT;
// resource-specific columns (origin, chat_message_id on tasks) come from in.
type preparedComment struct {
	ID          string
	Body        string
	CommentType string
	ParentID    pgtype.Text
	AuthorID    string
	AuthorKind  string
}

// commentVerbs is one resource's vocabulary: the same token names the audit
// action and the outbox topic.
type commentVerbs struct {
	resourceType    string // audit ResourceType and the "<type>_id" payload key
	added           string
	updated         string
	deleted         string
	resolved        string
	unresolved      string
	reactionAdded   string
	reactionRemoved string
}

// loadInResource is the id-addressed load inside a command's transaction:
// the comment must sit in ref's tenant pair and hang on ref's resource - a
// comment id of a sibling resource is not found, never readable.
func loadInResource[C any](ctx context.Context, q *db.Queries, ad commentAdapter[C], ref CommentRef, commentID string) (C, error) {
	c, err := ad.tenantGet(ctx, q, ref, commentID)
	if errors.Is(err, pgx.ErrNoRows) {
		return c, ErrNotFound
	}
	if err != nil {
		return c, err
	}
	if ad.identity(c).ResourceID != ref.ResourceID {
		return c, ErrNotFound
	}
	return c, nil
}

// checkCommentParent validates an optional reply target: it must exist in
// the tenant pair and hang on the same resource. A comment id from a
// sibling task/document is refused - never silently adopted.
func checkCommentParent[C any](ctx context.Context, q *db.Queries, ad commentAdapter[C], ref CommentRef, parentID *string) (pgtype.Text, error) {
	if parentID == nil || strings.TrimSpace(*parentID) == "" {
		return pgtype.Text{}, nil
	}
	pid := strings.TrimSpace(*parentID)
	parent, err := ad.tenantGet(ctx, q, ref, pid)
	if errors.Is(err, pgx.ErrNoRows) {
		return pgtype.Text{}, ErrNotFound
	}
	if err != nil {
		return pgtype.Text{}, err
	}
	if ad.identity(parent).ResourceID != ref.ResourceID {
		return pgtype.Text{}, errCommentParentForeign
	}
	return pgtype.Text{String: pid, Valid: true}, nil
}

// prepareComment runs the validating half of a create: body, the
// resource's comment_type allowlist and the same-resource parent check.
func prepareComment[C any](ctx context.Context, q *db.Queries, ad commentAdapter[C], ref CommentRef, actor Actor, in AddCommentInput) (preparedComment, error) {
	body, err := normalizeCommentBody(in.Body)
	if err != nil {
		return preparedComment{}, err
	}
	commentType, err := normalizeCommentType(in.CommentType, ad.commentTypes())
	if err != nil {
		return preparedComment{}, err
	}
	parent, err := checkCommentParent(ctx, q, ad, ref, in.ParentID)
	if errors.Is(err, errCommentParentForeign) {
		return preparedComment{}, ad.foreignParentError()
	}
	if err != nil {
		return preparedComment{}, err
	}
	return preparedComment{
		ID: util.NewID(), Body: body, CommentType: commentType,
		ParentID: parent, AuthorID: actor.ID, AuthorKind: string(actor.Kind),
	}, nil
}

// recordCommentAudit writes the audit row + outbox event a comment command
// commits in the caller's transaction (ADR 0009/0012); payloads carry ids
// only.
func recordCommentAudit(ctx context.Context, q *db.Queries, actor Actor, ref CommentRef, v commentVerbs, verb, commentID string, extra map[string]any) error {
	meta := map[string]any{"comment_id": commentID}
	for k, val := range extra {
		meta[k] = val
	}
	return auditRecorder.Record(ctx, q, audit.Entry{
		OrganizationID: ref.OrganizationID, WorkspaceID: ref.WorkspaceID,
		Actor: actor, Action: verb,
		ResourceType: v.resourceType, ResourceID: ref.ResourceID,
		Metadata: meta,
	}, audit.Event{Topic: verb, Payload: map[string]string{
		v.resourceType + "_id": ref.ResourceID, "comment_id": commentID, "workspace_id": ref.WorkspaceID,
	}})
}

// --- engine: the commands every resource shares ---------------------------

// addCommentOn runs the create half: validate, resolve the parent inside
// this resource, insert through the adapter, audit + outbox in the caller's
// transaction.
func addCommentOn[C any](ctx context.Context, q *db.Queries, ad commentAdapter[C], ref CommentRef, actor Actor, in AddCommentInput) (C, error) {
	var z C
	p, err := prepareComment(ctx, q, ad, ref, actor, in)
	if err != nil {
		return z, err
	}
	c, err := ad.insert(ctx, q, ref, in, p)
	if err != nil {
		return z, err
	}
	v := ad.verbs()
	if err := recordCommentAudit(ctx, q, actor, ref, v, v.added, p.ID, nil); err != nil {
		return z, err
	}
	return c, nil
}

// updateCommentOn is the shared edit: re-read inside the transaction,
// author-or-manager, validated body, revision-bumping update, audit.
func updateCommentOn[C any](ctx context.Context, q *db.Queries, ad commentAdapter[C], ref CommentRef, actor Actor, commentID string, in UpdateCommentInput) (C, error) {
	var z C
	c, err := loadInResource(ctx, q, ad, ref, commentID)
	if err != nil {
		return z, err
	}
	allowed, err := ad.canModerate(ctx, actor, ref, c)
	if err != nil {
		return z, err
	}
	if !allowed {
		return z, ErrForbidden
	}
	body, err := normalizeCommentBody(in.Body)
	if err != nil {
		return z, err
	}
	c, err = ad.updateBody(ctx, q, ref, c, body)
	if err != nil {
		return z, err
	}
	v := ad.verbs()
	if err := recordCommentAudit(ctx, q, actor, ref, v, v.updated, commentID, nil); err != nil {
		return z, err
	}
	return c, nil
}

// deleteCommentOn is the shared delete: re-read, author-or-manager, the
// adapter's in-transaction cleanup hook, then the row.
func deleteCommentOn[C any](ctx context.Context, q *db.Queries, ad commentAdapter[C], ref CommentRef, actor Actor, commentID string) error {
	c, err := loadInResource(ctx, q, ad, ref, commentID)
	if err != nil {
		return err
	}
	allowed, err := ad.canModerate(ctx, actor, ref, c)
	if err != nil {
		return err
	}
	if !allowed {
		return ErrForbidden
	}
	if err := ad.beforeDelete(ctx, q, ref, c); err != nil {
		return err
	}
	if err := ad.remove(ctx, q, ref, c); err != nil {
		return err
	}
	v := ad.verbs()
	return recordCommentAudit(ctx, q, actor, ref, v, v.deleted, commentID, nil)
}

// setCommentResolvedOn is the shared resolve/unresolve: the update's WHERE
// carries the idempotent guard, so a repeat returns the current row
// untouched and audits nothing.
func setCommentResolvedOn[C any](ctx context.Context, q *db.Queries, ad commentAdapter[C], ref CommentRef, actor Actor, commentID string, on bool) (C, error) {
	c, err := loadInResource(ctx, q, ad, ref, commentID)
	if err != nil {
		return c, err
	}
	v := ad.verbs()
	verb := v.resolved
	var row C
	if on {
		row, err = ad.resolve(ctx, q, ref, c, commentActorType(actor.Kind), actor.ID)
	} else {
		verb = v.unresolved
		row, err = ad.unresolve(ctx, q, ref, c)
	}
	if errors.Is(err, pgx.ErrNoRows) {
		// Already in that state - return the row as loaded, no audit.
		return c, nil
	}
	if err != nil {
		var z C
		return z, err
	}
	if err := recordCommentAudit(ctx, q, actor, ref, v, verb, commentID, nil); err != nil {
		var z C
		return z, err
	}
	return row, nil
}

// --- reactions ------------------------------------------------------------

// putCommentReaction writes the comment_reactions upsert: created=true when
// this call inserted the row, created=false with the existing row on a
// repeat (the UNIQUE key makes add idempotent; repeats audit nothing).
func putCommentReaction(ctx context.Context, q *db.Queries, ref CommentRef, commentID, actorType, actorID, emoji string) (db.CommentReaction, bool, error) {
	row, err := q.InsertCommentReaction(ctx, db.InsertCommentReactionParams{
		ID: util.NewID(), OrganizationID: ref.OrganizationID, WorkspaceID: ref.WorkspaceID,
		CommentID: commentID, ActorType: actorType, ActorID: actorID, Emoji: emoji,
	})
	if err == nil {
		return row, true, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return db.CommentReaction{}, false, err
	}
	existing, lerr := q.ListCommentReactions(ctx, db.ListCommentReactionsParams{
		CommentID: commentID, OrganizationID: ref.OrganizationID, WorkspaceID: ref.WorkspaceID,
	})
	if lerr != nil {
		return db.CommentReaction{}, false, lerr
	}
	for _, r := range existing {
		if r.ActorType == actorType && r.ActorID == actorID && r.Emoji == emoji {
			return r, false, nil
		}
	}
	return db.CommentReaction{}, false, ErrNotFound
}

// dropCommentReaction removes the actor's emoji; false when nothing was
// there, so a no-op remove audits nothing.
func dropCommentReaction(ctx context.Context, q *db.Queries, ref CommentRef, commentID, actorType, actorID, emoji string) (bool, error) {
	n, err := q.DeleteCommentReaction(ctx, db.DeleteCommentReactionParams{
		CommentID: commentID, OrganizationID: ref.OrganizationID, WorkspaceID: ref.WorkspaceID,
		ActorType: actorType, ActorID: actorID, Emoji: emoji,
	})
	if err != nil {
		return false, err
	}
	return n > 0, nil
}

// reactToCommentOn runs the shared reaction add: the comment is proven to
// belong to ref's resource through the adapter before comment_reactions is
// touched.
func reactToCommentOn[C any](ctx context.Context, q *db.Queries, ad commentAdapter[C], ref CommentRef, actor Actor, commentID, emoji string) (db.CommentReaction, error) {
	if _, err := loadInResource(ctx, q, ad, ref, commentID); err != nil {
		return db.CommentReaction{}, err
	}
	emoji, err := validateReactionEmoji(emoji)
	if err != nil {
		return db.CommentReaction{}, err
	}
	row, created, err := putCommentReaction(ctx, q, ref, commentID, commentActorType(actor.Kind), actor.ID, emoji)
	if err != nil {
		return db.CommentReaction{}, err
	}
	if !created {
		return row, nil
	}
	v := ad.verbs()
	if err := recordCommentAudit(ctx, q, actor, ref, v, v.reactionAdded, commentID, map[string]any{"emoji": emoji}); err != nil {
		return db.CommentReaction{}, err
	}
	return row, nil
}

// unreactToCommentOn is the shared reaction remove; a no-op audits nothing.
func unreactToCommentOn[C any](ctx context.Context, q *db.Queries, ad commentAdapter[C], ref CommentRef, actor Actor, commentID, emoji string) error {
	if _, err := loadInResource(ctx, q, ad, ref, commentID); err != nil {
		return err
	}
	emoji, err := validateReactionEmoji(emoji)
	if err != nil {
		return err
	}
	changed, err := dropCommentReaction(ctx, q, ref, commentID, commentActorType(actor.Kind), actor.ID, emoji)
	if err != nil {
		return err
	}
	if !changed {
		return nil
	}
	v := ad.verbs()
	return recordCommentAudit(ctx, q, actor, ref, v, v.reactionRemoved, commentID, map[string]any{"emoji": emoji})
}
