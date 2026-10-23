package notification

import "testing"

// create_document tells the model that no one is notified of a page it
// creates, and update_document that only a rename notifies (UNI-2056: the
// document.updated rule answers a title move only, and the
// document.version_created rule an uploaded file version, never a page
// version). A rule for document.created makes the first sentence false.
func TestDocumentPageEventsHaveNoNotificationRule(t *testing.T) {
	for _, topic := range []string{"document.created"} {
		if _, ok := rules[topic]; ok {
			t.Errorf("%s has a notification rule; update the descriptions of create_document and update_document in service/mcp_tools_documents.go", topic)
		}
	}
}
