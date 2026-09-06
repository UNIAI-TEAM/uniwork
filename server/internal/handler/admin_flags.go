package handler

import "net/http"

// Flag overrides land with plan F1; the routes exist so the OpenAPI catalog
// and the console navigation are complete from the first admin release.

func (h *handlers) adminListFlags(w http.ResponseWriter, r *http.Request) {
	respondError(w, http.StatusNotImplemented, "not_implemented", "flags arrive with F1")
}

func (h *handlers) adminListFlagOverrides(w http.ResponseWriter, r *http.Request) {
	respondError(w, http.StatusNotImplemented, "not_implemented", "flags arrive with F1")
}

func (h *handlers) adminSetFlagOverride(w http.ResponseWriter, r *http.Request) {
	respondError(w, http.StatusNotImplemented, "not_implemented", "flags arrive with F1")
}

func (h *handlers) adminDeleteFlagOverride(w http.ResponseWriter, r *http.Request) {
	respondError(w, http.StatusNotImplemented, "not_implemented", "flags arrive with F1")
}
