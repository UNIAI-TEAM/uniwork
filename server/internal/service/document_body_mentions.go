package service

import (
	"context"
	"encoding/json"

	"github.com/unicomhub/uniwork/server/internal/audit"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// Body mentions (UNI-1968, BODY-MENTION-NOTIFY): a mention typed into a
// UniNote page body notifies the people the save newly names. The diff runs
// inside the save transaction against the content the row still holds, so
// saving the same content again says nothing and removing a mention before
// saving it back notifies again (C-01 §5.1). This file holds the extraction
// and the write-side filter; the delivery-time read gate is
// notification/rules.go's ruleDocumentBodyMentioned.

// maxBodyMentionsPerSave bounds how many people one save may newly notify: a
// paste of a long document must not fan out into an unbounded number of
// events. The ids past the cap are dropped, and the audit metadata carries the
// count the save named before the cap, so the drop is visible.
const maxBodyMentionsPerSave = 50

// bodyMentionUserIDs collects, in document order, the user ids every mention
// node of a sanitized page names. Only a mention of kind "user" names a
// person; a mention with no kind counts as one (the editor always writes the
// kind, an older row need not). An id appears once however many times the body
// mentions it.
func bodyMentionUserIDs(content []byte) []string {
	if len(content) == 0 {
		return nil
	}
	var root any
	if err := json.Unmarshal(content, &root); err != nil {
		return nil
	}
	var ids []string
	seen := map[string]bool{}
	var walk func(v any)
	walk = func(v any) {
		switch n := v.(type) {
		case map[string]any:
			if n["type"] == "mention" {
				if attrs, ok := n["attrs"].(map[string]any); ok {
					if kind, ok := attrs["kind"].(string); !ok || kind == "user" {
						if id, ok := attrs["id"].(string); ok && id != "" && !seen[id] {
							seen[id] = true
							ids = append(ids, id)
						}
					}
				}
			}
			if children, ok := n["content"].([]any); ok {
				for _, c := range children {
					walk(c)
				}
			}
		case []any:
			for _, c := range n {
				walk(c)
			}
		}
	}
	walk(root)
	return ids
}

// newBodyMentionRecipients is the people one content save newly names in the
// page body: the user mentions of after that before did not have, minus the
// saving actor, minus anybody who is not an active human member of the
// document's organization. An actor that is not human notifies nobody (ADR
// 0010: the agent runtime never triggers a body-mention notification), and an
// agent id is never an organization_members row, so the membership filter
// covers it too.
//
// It returns the ids to notify in document order, capped at
// maxBodyMentionsPerSave, and the count the save named before the cap.
//
// Read access is not decided here: the notification rule re-checks it at
// delivery time (FilterDocumentReaders), so a person whose access was revoked
// between the save and the run gets no row and no push, and a person who could
// not read the page never has a title leak. This step only keeps the ids inside
// the tenant, which is what makes the event safe to write at all.
//
// It runs on the caller's q: this is inside the save transaction, which
// already holds the document row lock and a pool connection, so a second
// borrow could deadlock a saturated pool (TestDocumentMutationGateOnSmallPool).
func (s *DocumentService) newBodyMentionRecipients(ctx context.Context, q *db.Queries, actor Actor, doc db.Document, before, after []byte) ([]string, int, error) {
	if actor.Kind != audit.KindHuman {
		return nil, 0, nil
	}
	had := bodyMentionUserIDs(before)
	seen := make(map[string]bool, len(had))
	for _, id := range had {
		seen[id] = true
	}
	var added []string
	for _, id := range bodyMentionUserIDs(after) {
		if seen[id] || id == actor.ID {
			continue
		}
		seen[id] = true
		added = append(added, id)
	}
	if len(added) == 0 {
		return nil, 0, nil
	}
	members, err := q.ListActiveOrganizationMemberIds(ctx, db.ListActiveOrganizationMemberIdsParams{
		OrganizationID: doc.OrganizationID, UserIds: added,
	})
	if err != nil {
		return nil, 0, err
	}
	inOrg := make(map[string]bool, len(members))
	for _, id := range members {
		inOrg[id] = true
	}
	kept := make([]string, 0, len(added))
	for _, id := range added {
		if inOrg[id] {
			kept = append(kept, id)
		}
	}
	named := len(kept)
	if len(kept) > maxBodyMentionsPerSave {
		kept = kept[:maxBodyMentionsPerSave]
	}
	return kept, named, nil
}
