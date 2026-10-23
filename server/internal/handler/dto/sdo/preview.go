package sdo

// PreviewAssetDTO is an opaque broker URL. It contains no app cookie, bearer
// token, storage key or arbitrary URL input.
type PreviewAssetDTO struct {
	Key     string `json:"key"`
	AssetID string `json:"asset_id"`
	URL     string `json:"url"`
}

// PreviewScopeSDO is returned by POST /documents/{id}/preview/scopes.
type PreviewScopeSDO struct {
	Origin    string            `json:"origin"`
	ExpiresAt string            `json:"expires_at"`
	Assets    []PreviewAssetDTO `json:"assets"`
}
