package router

// registerPreview mounts only the cookie-less broker read route. Scope minting
// is mounted with the Documents authenticated group because it needs the
// caller's session and ACL.
func registerPreview(r api, h Routes) {
	r.Get("/preview/assets/{capability}/{assetID}", h.GetPreviewAsset, apiOp{
		summary:     "Read one isolated preview asset",
		description: "Streams one manifest-bound asset through an opaque short-lived capability. Invalid, expired, replayed and foreign scopes are indistinguishable from a missing asset.",
		tags:        []string{"documents"},
		produces:    "application/octet-stream",
	})
}
