package service

// G1-07 (UNI-681): the shared comment core's contract, proven without a
// database through a fake adapter - validation rules, the same-resource
// parent check, the tenant+resource scoped load, the author-or-manager
// half, and the idempotent resolve path.

import (
	"context"
	"errors"
	"testing"

	"github.com/jackc/pgx/v5"

	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// fakeComment is the row a fake adapter serves the engine; the tenant pair
// rides along so tenantGet behaves like the scoped queries it stands in for.
type fakeComment struct {
	id         string
	resourceID string
	orgID      string
	wsID       string
	authorID   string
	authorKind string
}

// fakeCommentAdapter is the persistence+authorizer stub; q is never used -
// the fake serves from memory, so the engine tests run without a database.
// updateErr lets a test prove moderation let the write through without the
// audit write a real database would need.
type fakeCommentAdapter struct {
	rows       map[string]fakeComment
	manager    bool // the manager half of canModerate
	resolveErr error
	updateErr  error
	deleted    []string
}

func (a *fakeCommentAdapter) byID(_ context.Context, _ *db.Queries, id string) (fakeComment, error) {
	c, ok := a.rows[id]
	if !ok {
		return fakeComment{}, pgx.ErrNoRows
	}
	return c, nil
}

func (a *fakeCommentAdapter) tenantGet(ctx context.Context, q *db.Queries, ref CommentRef, id string) (fakeComment, error) {
	c, err := a.byID(ctx, q, id)
	if err != nil {
		return c, err
	}
	if c.orgID != ref.OrganizationID || c.wsID != ref.WorkspaceID {
		return fakeComment{}, pgx.ErrNoRows
	}
	return c, nil
}

func (fakeCommentAdapter) identity(c fakeComment) commentIdentity {
	return commentIdentity{ID: c.id, ResourceID: c.resourceID, AuthorID: c.authorID, AuthorKind: c.authorKind}
}

func (fakeCommentAdapter) insert(_ context.Context, _ *db.Queries, _ CommentRef, _ AddCommentInput, p preparedComment) (fakeComment, error) {
	return fakeComment{id: p.ID, resourceID: "doc1", orgID: "org1", wsID: "ws1", authorID: p.AuthorID, authorKind: p.AuthorKind}, nil
}

func (a *fakeCommentAdapter) updateBody(_ context.Context, _ *db.Queries, _ CommentRef, c fakeComment, _ string) (fakeComment, error) {
	return c, a.updateErr
}

func (a *fakeCommentAdapter) remove(_ context.Context, _ *db.Queries, _ CommentRef, c fakeComment) error {
	a.deleted = append(a.deleted, c.id)
	return nil
}

func (a *fakeCommentAdapter) resolve(_ context.Context, _ *db.Queries, _ CommentRef, c fakeComment, _, _ string) (fakeComment, error) {
	return c, a.resolveErr
}

func (fakeCommentAdapter) unresolve(_ context.Context, _ *db.Queries, _ CommentRef, c fakeComment) (fakeComment, error) {
	return c, nil
}

func (fakeCommentAdapter) commentTypes() []string { return []string{"comment"} }

func (fakeCommentAdapter) foreignParentError() error {
	return Invalid("parent_id không thuộc tài liệu này")
}

func (a *fakeCommentAdapter) canModerate(_ context.Context, actor Actor, _ CommentRef, c fakeComment) (bool, error) {
	id := a.identity(c)
	if id.AuthorID == actor.ID && id.AuthorKind == string(actor.Kind) {
		return true, nil
	}
	return a.manager, nil
}

func (fakeCommentAdapter) beforeDelete(_ context.Context, _ *db.Queries, _ CommentRef, _ fakeComment) error {
	return nil
}

func (fakeCommentAdapter) verbs() commentVerbs {
	return commentVerbs{
		resourceType:    "document",
		added:           "document.comment_added",
		updated:         "document.comment_updated",
		deleted:         "document.comment_deleted",
		resolved:        "document.comment_resolved",
		unresolved:      "document.comment_unresolved",
		reactionAdded:   "document.comment_reaction_added",
		reactionRemoved: "document.comment_reaction_removed",
	}
}

var coreRef = CommentRef{Kind: CommentResourceDocument, ResourceID: "doc1", OrganizationID: "org1", WorkspaceID: "ws1"}

func TestCommentCoreValidation(t *testing.T) {
	if got, err := normalizeCommentBody("  chào  "); err != nil || got != "chào" {
		t.Fatalf("normalizeCommentBody = %q, %v", got, err)
	}
	for _, b := range []string{"", "   ", "\n\t"} {
		if _, err := normalizeCommentBody(b); err == nil {
			t.Fatalf("empty body %q accepted", b)
		}
	}
	for _, tt := range []struct {
		in      string
		allowed []string
		want    string
		wantErr bool
	}{
		{"", []string{"comment"}, "comment", false},
		{" comment ", []string{"comment"}, "comment", false},
		// The document allowlist is the narrow one: a public client can
		// never mint a system row.
		{"system", []string{"comment"}, "", true},
		{"status_change", []string{"comment"}, "", true},
		{"system", []string{"comment", "status_change", "progress_update", "system"}, "system", false},
		{"nonsense", []string{"comment"}, "", true},
	} {
		got, err := normalizeCommentType(tt.in, tt.allowed)
		if tt.wantErr && err == nil {
			t.Fatalf("comment_type %q accepted", tt.in)
		}
		if !tt.wantErr && (err != nil || got != tt.want) {
			t.Fatalf("comment_type %q = %q, %v", tt.in, got, err)
		}
	}
}

func TestCommentCoreParentCheck(t *testing.T) {
	ad := &fakeCommentAdapter{rows: map[string]fakeComment{
		"c-parent": {id: "c-parent", resourceID: "doc1", orgID: "org1", wsID: "ws1"},
		// A comment of a sibling resource in the SAME tenant pair: the
		// check sees it and refuses it, it never becomes a parent.
		"c-other": {id: "c-other", resourceID: "doc2", orgID: "org1", wsID: "ws1"},
		// Same resource id string in another tenant - the scoped load
		// does not even see it.
		"c-tenant": {id: "c-tenant", resourceID: "doc1", orgID: "org2", wsID: "ws2"},
	}}
	ctx := context.Background()

	for _, p := range []*string{nil, strptr(""), strptr("   ")} {
		if got, err := checkCommentParent(ctx, nil, ad, coreRef, p); err != nil || got.Valid {
			t.Fatalf("no parent: %+v %v", got, err)
		}
	}
	if got, err := checkCommentParent(ctx, nil, ad, coreRef, strptr(" c-parent ")); err != nil || !got.Valid || got.String != "c-parent" {
		t.Fatalf("valid parent: %+v %v", got, err)
	}
	if _, err := checkCommentParent(ctx, nil, ad, coreRef, strptr("missing")); !errors.Is(err, ErrNotFound) {
		t.Fatalf("missing parent: %v", err)
	}
	if _, err := checkCommentParent(ctx, nil, ad, coreRef, strptr("c-tenant")); !errors.Is(err, ErrNotFound) {
		t.Fatalf("foreign-tenant parent: %v", err)
	}
	if _, err := checkCommentParent(ctx, nil, ad, coreRef, strptr("c-other")); !errors.Is(err, errCommentParentForeign) {
		t.Fatalf("sibling-resource parent: %v", err)
	}
	// prepareComment maps the foreign parent onto the adapter's wording.
	_, err := prepareComment(ctx, nil, ad, coreRef, Human("u1"), AddCommentInput{Body: "x", ParentID: strptr("c-other")})
	var ve ValidationError
	if !errors.As(err, &ve) || ve.Msg != "parent_id không thuộc tài liệu này" {
		t.Fatalf("foreign parent error = %v", err)
	}
}

func TestCommentCoreLoadInResource(t *testing.T) {
	ad := &fakeCommentAdapter{rows: map[string]fakeComment{
		"c1": {id: "c1", resourceID: "doc1", orgID: "org1", wsID: "ws1"},
		"c2": {id: "c2", resourceID: "doc2", orgID: "org1", wsID: "ws1"},
	}}
	ctx := context.Background()
	if _, err := loadInResource(ctx, nil, ad, coreRef, "c1"); err != nil {
		t.Fatalf("own comment: %v", err)
	}
	if _, err := loadInResource(ctx, nil, ad, coreRef, "c2"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("sibling resource comment: %v", err)
	}
	if _, err := loadInResource(ctx, nil, ad, coreRef, "gone"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("missing comment: %v", err)
	}
}

func TestCommentCoreModerationGate(t *testing.T) {
	ad := &fakeCommentAdapter{rows: map[string]fakeComment{
		"c1": {id: "c1", resourceID: "doc1", orgID: "org1", wsID: "ws1", authorID: "u1", authorKind: "human"},
	}}
	ctx := context.Background()

	// A non-author without the manager half is refused before any write.
	if _, err := updateCommentOn(ctx, nil, ad, coreRef, Human("u2"), "c1", UpdateCommentInput{Body: "x"}); !errors.Is(err, ErrForbidden) {
		t.Fatalf("non-author update: %v", err)
	}
	if err := deleteCommentOn(ctx, nil, ad, coreRef, Human("u2"), "c1"); !errors.Is(err, ErrForbidden) {
		t.Fatalf("non-author delete: %v", err)
	}
	// The manager half lets a non-author through to the write - the fake's
	// sentinel propagates where a real adapter would have written and then
	// audited.
	ad.manager = true
	ad.updateErr = errFakeUpdate
	if _, err := updateCommentOn(ctx, nil, ad, coreRef, Human("u2"), "c1", UpdateCommentInput{Body: "x"}); !errors.Is(err, errFakeUpdate) {
		t.Fatalf("manager update: %v", err)
	}
	// An empty body is still Invalid for the author.
	if _, err := updateCommentOn(ctx, nil, ad, coreRef, Human("u1"), "c1", UpdateCommentInput{Body: "  "}); err == nil {
		t.Fatal("empty body accepted")
	}
}

func TestCommentCoreResolveIdempotent(t *testing.T) {
	ad := &fakeCommentAdapter{
		resolveErr: pgx.ErrNoRows, // the UPDATE's resolved_at IS NULL guard
		rows: map[string]fakeComment{
			"c1": {id: "c1", resourceID: "doc1", orgID: "org1", wsID: "ws1"},
		},
	}
	got, err := setCommentResolvedOn(context.Background(), nil, ad, coreRef, Human("u1"), "c1", true)
	if err != nil {
		t.Fatalf("re-resolve: %v", err)
	}
	if got.id != "c1" {
		t.Fatalf("re-resolve returned %+v", got)
	}
}

func TestCommentCoreReactionNeedsTheResource(t *testing.T) {
	// A comment id that exists but hangs on a sibling resource answers
	// not-found before comment_reactions is ever touched (nil q would
	// panic if a reaction query ran).
	ad := &fakeCommentAdapter{rows: map[string]fakeComment{
		"c2": {id: "c2", resourceID: "doc2", orgID: "org1", wsID: "ws1"},
	}}
	ctx := context.Background()
	if _, err := reactToCommentOn(ctx, nil, ad, coreRef, Human("u1"), "c2", "👍"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("reaction on foreign comment: %v", err)
	}
	if err := unreactToCommentOn(ctx, nil, ad, coreRef, Human("u1"), "c2", "👍"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("unreaction on foreign comment: %v", err)
	}
}

var errFakeUpdate = errors.New("fake update reached")
