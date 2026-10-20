package notification

import "testing"

// create_document and update_document tell the model that no one is notified of
// a page that is created, changed or versioned: only comments and a page-body
// mention (document.body_mentioned) have document rules. A rule for one of
// these topics makes that sentence false.
func TestDocumentPageEventsHaveNoNotificationRule(t *testing.T) {
	for _, topic := range []string{"document.created", "document.updated", "document.version_created"} {
		if _, ok := rules[topic]; ok {
			t.Errorf("%s has a notification rule; update the descriptions of create_document and update_document in service/mcp_tools_documents.go", topic)
		}
	}
}
