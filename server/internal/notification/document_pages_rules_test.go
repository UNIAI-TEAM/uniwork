package notification

import "testing"

// create_document and update_document tell the model that no one is notified of
// a page that is created, changed or versioned (a mention inside the page
// included): only comments have document rules. A rule for one of these topics
// makes that sentence false.
func TestDocumentPageEventsHaveNoNotificationRule(t *testing.T) {
	for _, topic := range []string{"document.created", "document.updated", "document.version_created"} {
		if _, ok := rules[topic]; ok {
			t.Errorf("%s has a notification rule; update the descriptions of create_document and update_document in service/mcp_tools_documents.go", topic)
		}
	}
}
