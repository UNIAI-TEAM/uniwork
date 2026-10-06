package sdi

// PreviewAssetSDI names one manifest entry and its opaque Documents asset id.
// The path is metadata only; the broker never turns it into a filesystem or
// storage lookup.
type PreviewAssetSDI struct {
	Key     string `json:"key" description:"Manifest key, retained for URL mapping"`
	AssetID string `json:"asset_id" description:"Opaque document asset id"`
}

// CreatePreviewScopeSDI mints a short-lived, frame-scoped asset capability.
type CreatePreviewScopeSDI struct {
	JobID  string            `json:"job_id" description:"Preview render/job identity"`
	Assets []PreviewAssetSDI `json:"assets" description:"Only manifest assets needed by this frame"`
}
