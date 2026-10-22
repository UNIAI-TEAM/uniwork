package service

import "github.com/unicomhub/uniwork/server/internal/audit"

// The verbs a command writes on document.change_noticed (UNI-2056). The
// notification rule reads the same strings from the payload; moved,
// relocated, trashed, deleted and the share verbs ride their own topics,
// which already have a notify-lane consumer.
const (
	docNoticeRenamed        = "renamed"
	docNoticeRestored       = "restored"
	docNoticeShelved        = "shelved"
	docNoticeUnshelved      = "unshelved"
	docNoticeAccessChanged  = "access_changed"
	docNoticeVersionCreated = "version_created"
)

// documentChangeNotice is the server-only row a command writes in the same
// Record call as its client frame when the change is one people hear of
// (UNI-2056 BE-R1-1). The notification consumer listens to this topic, not
// to the frame topics, so document.updated, .restored, .shelved,
// .unshelved, .workspace_access_changed, .link_created, .link_revoked and
// .version_created keep no notify-lane consumer and stay on the realtime
// lane with the Documents UI and the chat card refresh.
func documentChangeNotice(documentID, workspaceID, verb string) audit.Event {
	return audit.Event{Topic: "document.change_noticed", Payload: map[string]string{
		"document_id": documentID, "workspace_id": workspaceID, "verb": verb,
	}}
}
