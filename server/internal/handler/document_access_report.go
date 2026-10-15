package handler

import "net/http"

// Document access report HTTP (UNI-1643). The service decides every level;
// the handler parses the query, resolves display names for the page and
// writes the wire shape.

// documentAccessReport is GET /workspaces/{workspaceID}/documents/access-report.
func (h *handlers) documentAccessReport(w http.ResponseWriter, _ *http.Request) {
	respondError(w, http.StatusNotImplemented, "not_implemented", "the access report is not implemented yet")
}

// exportDocumentAccessReport is GET
// /workspaces/{workspaceID}/documents/access-report/export.
func (h *handlers) exportDocumentAccessReport(w http.ResponseWriter, _ *http.Request) {
	respondError(w, http.StatusNotImplemented, "not_implemented", "the access report export is not implemented yet")
}
