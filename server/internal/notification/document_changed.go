package notification

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/outbox"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// The verbs of a document_changed notice (params.verb, UNI-2056 §4). The
// client builds the sentence from the verb; the kind stays one switch in the
// preference matrix (Q1).
const (
	docVerbRenamed        = "renamed"
	docVerbMoved          = "moved"
	docVerbRelocated      = "relocated"
	docVerbTrashed        = "trashed"
	docVerbRestored       = "restored"
	docVerbDeleted        = "deleted"
	docVerbShelved        = "shelved"
	docVerbUnshelved      = "unshelved"
	docVerbAccessChanged  = "access_changed"
	docVerbVersionCreated = "version_created"
)

// docChangeSamples bounds sample_document_ids: the inbox names a few titles
// and counts the rest.
const docChangeSamples = 3

// DocChange is the part of a document_changed draft the fold write path
// needs: the group prefix it searches under (same actor and verb), the one
// document this event adds, and the title kept for a purged document.
type DocChange struct {
	GroupPrefix   string
	DocumentID    string
	TitleSnapshot string
}

// documentPastReaders is the trash half of the read port: who could read the
// document before it went to the trash. Archiving moves only archived_at, so
// the ACL answers as if the row were live. DocumentService implements it;
// the rule finds it on the injected DocumentReadChecker, so no new setter.
type documentPastReaders interface {
	FilterDocumentReadersIgnoringTrash(ctx context.Context, documentID string, userIDs []string) ([]string, error)
}

// docChangeOpts is what differs between the topics feeding one verb.
type docChangeOpts struct {
	// ignoreTrash asks the readers just before a trash command.
	ignoreTrash bool
	// ownerAlways tells the owner even when the document is private (the
	// rule-7 relocation: the owner is not the one who moved it).
	ownerAlways bool
	// anyPrivacy skips the non-private test: an access change that made a
	// document private was non-private just before it.
	anyPrivacy bool
	// exclude are people another notice of the same command already reached.
	exclude []string
}

// both runs two rules on one topic and keeps every draft: a topic with an
// older per-event notice and a document_changed notice.
func both(a, b rule) rule {
	return func(ctx context.Context, e env, ev outbox.Row, p map[string]string) ([]Draft, error) {
		first, err := a(ctx, e, ev, p)
		if err != nil {
			return nil, err
		}
		second, err := b(ctx, e, ev, p)
		if err != nil {
			return nil, err
		}
		return append(first, second...), nil
	}
}

// docChangeRule is the rule of a topic whose verb never depends on the row.
func docChangeRule(verb string) rule {
	return func(ctx context.Context, e env, ev outbox.Row, p map[string]string) ([]Draft, error) {
		return documentChangeDrafts(ctx, e, ev, p, verb, docChangeOpts{anyPrivacy: verb == docVerbAccessChanged})
	}
}

// noticedVerbs are the verbs a command may write on document.change_noticed;
// the command already decided the change is in scope (a new title, an
// uploaded version), so the rule only addresses it.
var noticedVerbs = map[string]bool{
	docVerbRenamed: true, docVerbRestored: true, docVerbShelved: true, docVerbUnshelved: true,
	docVerbAccessChanged: true, docVerbVersionCreated: true,
}

// ruleDocumentChangeNoticed is the rule of the server-only topic the
// rename, restore, shelve, unshelve, access, link and upload commands write
// beside their frame (BE-R1-1).
func ruleDocumentChangeNoticed(ctx context.Context, e env, ev outbox.Row, p map[string]string) ([]Draft, error) {
	verb := p["verb"]
	if !noticedVerbs[verb] {
		return nil, nil
	}
	return documentChangeDrafts(ctx, e, ev, p, verb, docChangeOpts{anyPrivacy: verb == docVerbAccessChanged})
}

// ruleDocumentMovedChange tells a move from a rule-7 relocation by the
// command's audit row (hook proposal v2): the payload stays ids-only.
func ruleDocumentMovedChange(ctx context.Context, e env, ev outbox.Row, p map[string]string) ([]Draft, error) {
	if !docChangeActor(ev) {
		return nil, nil
	}
	meta, err := auditMetadata(ctx, e.q, ev, audit.ActionDocumentMoved, p["document_id"])
	if err != nil {
		return nil, err
	}
	if reason, _ := meta["reason"].(string); reason == audit.ReasonFolderTrashed {
		return documentChangeDrafts(ctx, e, ev, p, docVerbRelocated, docChangeOpts{ownerAlways: true})
	}
	return documentChangeDrafts(ctx, e, ev, p, docVerbMoved, docChangeOpts{})
}

// ruleDocumentTrashedChange asks the readers just before the trash command
// and leaves out the batch's owners, whom document_trashed_by_other tells
// (rule 6).
func ruleDocumentTrashedChange(ctx context.Context, e env, ev outbox.Row, p map[string]string) ([]Draft, error) {
	if !docChangeActor(ev) {
		return nil, nil
	}
	o := docChangeOpts{ignoreTrash: true}
	if batchID, wsID := p["archive_batch_id"], p["workspace_id"]; batchID != "" && wsID != "" && ev.OrganizationID.Valid {
		owners, err := e.q.ListArchiveBatchOwners(ctx, db.ListArchiveBatchOwnersParams{
			OrganizationID: ev.OrganizationID.String, WorkspaceID: wsID,
			ArchiveBatchID: pgtype.Text{String: batchID, Valid: true},
		})
		if err != nil {
			return nil, err
		}
		o.exclude = owners
	}
	return documentChangeDrafts(ctx, e, ev, p, docVerbTrashed, o)
}

// ruleDocumentDeletedChange: the purge removed the row, its shares and its
// stars, so the recipients and the title come from the purge's own audit row
// (metadata.notify_user_ids, metadata.title), written in the same
// transaction from the readers just before the purge.
func ruleDocumentDeletedChange(ctx context.Context, e env, ev outbox.Row, p map[string]string) ([]Draft, error) {
	docID, wsID := p["document_id"], p["workspace_id"]
	if !docChangeActor(ev) || e.docs == nil || docID == "" || wsID == "" || !ev.OrganizationID.Valid {
		return nil, nil
	}
	meta, err := auditMetadata(ctx, e.q, ev, audit.ActionDocumentDeleted, docID)
	if err != nil {
		return nil, err
	}
	title, _ := meta["title"].(string)
	raw, _ := meta["notify_user_ids"].([]any)
	users := make([]string, 0, len(raw))
	for _, v := range raw {
		if s, ok := v.(string); ok {
			users = append(users, s)
		}
	}
	excluded, err := commandExclusions(ctx, e, ev, nil)
	if err != nil {
		return nil, err
	}
	return docChangeDraftsFor(ctx, e, ev, p, ev.OrganizationID.String, wsID, docID, docVerbDeleted, title,
		withoutPeople(users, excluded)), nil
}

// documentChangeDrafts is the common path: the document's facts, the
// privacy test, the candidates (owner, live user shares, stars), the people
// another notice of the command reached, and the read gate.
func documentChangeDrafts(ctx context.Context, e env, ev outbox.Row, p map[string]string, verb string, o docChangeOpts) ([]Draft, error) {
	docID := p["document_id"]
	if !docChangeActor(ev) || e.docs == nil || docID == "" {
		return nil, nil
	}
	facts, err := e.q.GetDocumentChangeFacts(ctx, docID)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if (ev.OrganizationID.Valid && facts.OrganizationID != ev.OrganizationID.String) ||
		(ev.WorkspaceID.Valid && facts.WorkspaceID != ev.WorkspaceID.String) {
		return nil, nil
	}
	nonPrivate := facts.Visibility == "workspace" || facts.HasLiveShare || facts.HasLiveLink
	var candidates []string
	if facts.AclOwnerID.Valid {
		candidates = append(candidates, facts.AclOwnerID.String)
	}
	switch {
	case nonPrivate || o.anyPrivacy:
		audience, err := e.q.ListDocumentChangeAudience(ctx, db.ListDocumentChangeAudienceParams{
			OrganizationID: facts.OrganizationID, WorkspaceID: facts.WorkspaceID, DocumentID: facts.ID,
		})
		if err != nil {
			return nil, err
		}
		candidates = append(candidates, audience...)
	case o.ownerAlways:
	default:
		return nil, nil
	}
	excluded, err := commandExclusions(ctx, e, ev, o.exclude)
	if err != nil {
		return nil, err
	}
	candidates = withoutPeople(candidates, excluded)
	if len(candidates) == 0 {
		return nil, nil
	}
	var readers []string
	if past, ok := e.docs.(documentPastReaders); o.ignoreTrash && ok {
		readers, err = past.FilterDocumentReadersIgnoringTrash(ctx, facts.ID, candidates)
	} else {
		readers, err = e.docs.FilterDocumentReaders(ctx, facts.ID, candidates)
	}
	if err != nil {
		return nil, err
	}
	return docChangeDraftsFor(ctx, e, ev, p, facts.OrganizationID, facts.WorkspaceID, facts.ID, verb, "", readers), nil
}

// docChangeActor: a system actor - a retention sweep, a migration, the
// section-7 admin moves - sends no notice (Q7 and hook point 3). A row
// without actor_kind reads as system.
func docChangeActor(ev outbox.Row) bool {
	return actorKindOf(ev) != string(audit.KindSystem) && ev.ActorID.String != ""
}

// commandExclusions is the actor plus everyone this command already tells
// through another kind: the users it granted a share to (document_shared,
// rule 6), read from the command's own audit rows so the answer does not
// depend on which consumer ran first, plus the rule's own extra list.
func commandExclusions(ctx context.Context, e env, ev outbox.Row, extra []string) (map[string]bool, error) {
	out := map[string]bool{ev.ActorID.String: true}
	for _, id := range extra {
		out[id] = true
	}
	if ev.CorrelationID.Valid && ev.OrganizationID.Valid {
		grantees, err := e.q.ListCommandUserShareGrantees(ctx, db.ListCommandUserShareGranteesParams{
			OrganizationID: ev.OrganizationID.String, CorrelationID: ev.CorrelationID.String,
		})
		if err != nil {
			return nil, err
		}
		for _, id := range grantees {
			out[id] = true
		}
	}
	return out, nil
}

// withoutPeople keeps the distinct, non-empty ids not in excluded, in order.
func withoutPeople(ids []string, excluded map[string]bool) []string {
	seen := map[string]bool{}
	out := make([]string, 0, len(ids))
	for _, id := range ids {
		if id == "" || excluded[id] || seen[id] {
			continue
		}
		seen[id] = true
		out = append(out, id)
	}
	return out
}

// docCommandKey names the command an event belongs to: the request's
// correlation id, else the archive batch a trash command stamped, else the
// event itself. document.change_noticed carries ids and the verb only, so a
// restore or shelve without a request falls back to the event.
func docCommandKey(ev outbox.Row, p map[string]string) string {
	switch {
	case ev.CorrelationID.Valid && ev.CorrelationID.String != "":
		return ev.CorrelationID.String
	case p["archive_batch_id"] != "":
		return p["archive_batch_id"]
	}
	return ev.ID
}

// docChangeDraftsFor builds one draft per recipient. The group key carries
// workspace, actor, verb and command; the fold searches under the
// workspace-actor-and-verb prefix, so the group claim and the fold stay inside
// one workspace (BE-R1-3).
func docChangeDraftsFor(ctx context.Context, e env, ev outbox.Row, p map[string]string, orgID, wsID, docID, verb, title string, users []string) []Draft {
	if len(users) == 0 {
		return nil
	}
	prefix := fmt.Sprintf("doc_change:%s:%s:%s:", wsID, ev.ActorID.String, verb)
	groupKey := prefix + docCommandKey(ev, p)
	actor := actorName(ctx, e.q, ev)
	out := make([]Draft, 0, len(users))
	for _, uid := range users {
		out = append(out, Draft{
			UserID: uid, OrganizationID: orgID, WorkspaceID: wsID,
			Kind: KindDocumentChanged, GroupKey: groupKey,
			ResourceType: "document", ResourceID: docID,
			ActorKind: actorKindOf(ev), ActorID: ev.ActorID.String,
			Params:    map[string]string{"actor": actor, "verb": verb},
			DocChange: &DocChange{GroupPrefix: prefix, DocumentID: docID, TitleSnapshot: title},
		})
	}
	return out
}

// auditMetadata reads the metadata of the audit row the command wrote beside
// ev (same correlation, action and resource, no later than the event); nil
// when there is none.
func auditMetadata(ctx context.Context, q *db.Queries, ev outbox.Row, action, resourceID string) (map[string]any, error) {
	if !ev.CorrelationID.Valid || resourceID == "" {
		return nil, nil
	}
	row, err := q.GetAuditEventByCorrelation(ctx, db.GetAuditEventByCorrelationParams{
		CorrelationID: ev.CorrelationID.String, Action: action, ResourceID: resourceID, Before: ev.CreatedAt,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var meta map[string]any
	if err := json.Unmarshal([]byte(row.Metadata), &meta); err != nil {
		return nil, fmt.Errorf("notification: audit metadata of %s: %w", row.ID, err)
	}
	return meta, nil
}
