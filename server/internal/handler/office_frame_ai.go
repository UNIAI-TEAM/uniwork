package handler

import (
	"context"
	"net/http"

	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdo"
	"github.com/unicomhub/uniwork/server/internal/service"
)

// The web Office frame's AI (UNI-1014, CONTRACT C16, ADR 0029 D9): GO-A7's
// credential, BYOK proxy and cloud handlers mounted under
// /office-frame/documents/{documentID}/ai/... behind the frame token. The
// frame auth middleware has already verified the token, matched its document
// to {documentID} and checked the token module's flag; this resolver adds the
// per-request document ACL and hands the handlers the token's user and
// organization. Entitlement, credits, rate limits and audit are GO-A7's, the
// same as on the session routes.

// frameAIActor names the caller of a frame AI route: the frame token's user
// in the token's organization, and only while that user may still view the
// token's document (rechecked on every request, so revoking access or moving
// the document ends the frame's AI with its next call). AI credentials are
// personal rows of (organization, user), not part of the document, so view
// access is the bar for every route, credential PUT/DELETE included.
func (h *handlers) frameAIActor(r *http.Request) (string, string, error) {
	claims := officeFrameClaims(r)
	if claims.UserID == "" || claims.OrganizationID == "" || h.OfficeFrame == nil {
		return "", "", errAIActorMissing
	}
	if _, err := h.OfficeFrame.Authorize(r.Context(), claims); err != nil {
		return "", "", err
	}
	return claims.UserID, claims.OrganizationID, nil
}

// officeFrameAIGrant is what the host may grant a frame of this token: `ai`
// when the person could use the BYOK proxy in the document's organization
// (member, office.ai_byok, a credential store), and each cloud tool only with
// `ai` and while GO-A7's cloud status says that tool is available
// (office.ai_cloud and a configured provider). `uniwork_ai` (G6-03c) stands
// apart from BYOK: the cloud status says chat is on (member, office.ai_cloud,
// UniWork AI configured, office_ai_uniwork) and the format of the token's
// module has its office_ai_uniwork_<format> on. Any failure reads as off: the
// grant only shows or hides AI, every AI route still gates itself.
func (h *handlers) officeFrameAIGrant(ctx context.Context, claims service.OfficeFrameClaims) sdo.OfficeFrameAIGrantSDO {
	var out sdo.OfficeFrameAIGrantSDO
	if claims.UserID == "" || claims.OrganizationID == "" {
		return out
	}
	var cloud service.AICloudStatus
	cloudOK := false
	if h.AICloud != nil {
		st, err := h.AICloud.Status(ctx, claims.UserID, claims.OrganizationID, h.OfficeCapabilities)
		if err == nil {
			cloud, cloudOK = st, true
			out.UniworkAI = st.UniworkAIFor(claims.ModuleName())
		}
	}
	if h.AIBYOK == nil || h.AICredentials == nil {
		return out
	}
	ok, err := h.AIBYOK.Enabled(ctx, claims.UserID, claims.OrganizationID)
	if err != nil || !ok {
		return out
	}
	out.AI = true
	if !cloudOK || !cloud.Enabled {
		return out
	}
	out.WebSearch = cloud.Tools.WebSearch
	out.ImageSearch = cloud.Tools.ImageSearch
	out.ImageGeneration = cloud.Tools.ImageGenerate
	return out
}
