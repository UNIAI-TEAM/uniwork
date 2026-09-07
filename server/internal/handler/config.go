package handler

import (
	"net/http"

	"github.com/unicomhub/uniwork/server/internal/featureflags"
	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdo"
	"github.com/unicomhub/uniwork/server/internal/middleware"
	"github.com/unicomhub/uniwork/server/internal/workcapability"
	"github.com/unicomhub/uniwork/server/pkg/featureflag"
)

// config is GET /api/v1/config: the public flags for the caller (anonymous or
// signed in, optionally in an organization), the RUM sample rate, and the
// Work Management capability catalogue. Flags never grant anything —
// permission stays in the services — so the organization id in the query is
// trusted as a targeting hint only.
func (h *handlers) config(w http.ResponseWriter, r *http.Request) {
	ec := featureflag.EvalContext{UserID: middleware.UserID(r.Context()), OrganizationID: r.URL.Query().Get("organization_id")}
	ctx := featureflag.WithEvalContext(r.Context(), ec)
	respondJSON(w, 200, sdo.ConfigSDO{
		Flags:                      featureflags.EvaluateFrontendPublicFlags(ctx, h.FeatureFlags),
		RumSampleRate:              h.Cfg.RUMSampleRate,
		WorkManagementCapabilities: workcapability.Catalogue(),
	})
}
