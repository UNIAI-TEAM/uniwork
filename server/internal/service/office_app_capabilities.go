package service

import (
	"context"

	"github.com/unicomhub/uniwork/server/internal/featureflags"
	"github.com/unicomhub/uniwork/server/pkg/featureflag"
)

// OfficeCapabilitiesTTLSeconds is the lifetime the desktop app may keep a
// capability answer before it must re-read the route (plan X-03). The app
// owns the caching rule (EXPERIENCE > State Patterns > Capability tat); the
// server only states the number.
const OfficeCapabilitiesTTLSeconds = 300

// The registry keys this route evaluates (plan X-03). They are named once here
// so Get and its contract test read the same list: the test derives the keys
// from these constants and the format list below, so a key renamed in
// featureflags/keys.go fails it instead of silently evaluating the caller's
// default and dropping a capability the app asked about.
const (
	officeSyncFeedFlag          = "office_sync_feed"
	officeSyncWriteFlag         = "office_sync_write"
	officeOfflineLibraryFlag    = "office_offline_library"
	officeAIUniworkFlag         = "office_ai_uniwork"
	officeAIUniworkFormatPrefix = "office_ai_uniwork_"
)

// officeAIUniworkFormats is the per-format AI capability set, in the fixed
// order the wire list uses. Each token is the suffix of its flag key, so the
// list and the registry never drift: docx -> office_ai_uniwork_docx.
var officeAIUniworkFormats = []string{"docx", "xlsx", "pptx", "pdf", "markdown", "html"}

// OfficeAppCapabilities is the app-facing view of what Office features are
// enabled for one organization (plan X-03,
// GET /orgs/{orgID}/office/capabilities).
type OfficeAppCapabilities struct {
	SyncFeed         bool
	SyncWrite        bool
	OfflineLibrary   bool
	AIUniwork        bool
	AIUniworkFormats []string
	TTLSeconds       int
}

// OfficeCapabilitiesService answers the app capability route. It decides the
// caller membership here and evaluates the flags through the same
// featureflag.Service and override resolution (user > organization > global)
// that serves GET /api/v1/config, so the app and the web client never
// disagree about a flag.
type OfficeCapabilitiesService struct {
	orgs  *OrganizationService
	flags *featureflag.Service
}

func NewOfficeCapabilitiesService(orgs *OrganizationService, flags *featureflag.Service) *OfficeCapabilitiesService {
	return &OfficeCapabilitiesService{orgs: orgs, flags: flags}
}

// Get resolves the capability for userID in organizationID. Membership is the
// only gate: a non-member is refused the way every organization route refuses
// one (ErrForbidden, mapped to 403/404 by the handler), a deactivated member
// and a suspended organization keep their existing gates, and the flags only
// hide a capability - they never grant one.
func (s *OfficeCapabilitiesService) Get(ctx context.Context, userID, orgID string) (OfficeAppCapabilities, error) {
	if _, err := s.orgs.RequireMember(ctx, orgID, userID); err != nil {
		return OfficeAppCapabilities{}, err
	}
	ctx = featureflag.WithEvalContext(ctx, featureflag.EvalContext{UserID: userID, OrganizationID: orgID})
	out := OfficeAppCapabilities{
		SyncFeed:       s.enabled(ctx, officeSyncFeedFlag),
		SyncWrite:      s.enabled(ctx, officeSyncWriteFlag),
		OfflineLibrary: s.enabled(ctx, officeOfflineLibraryFlag),
		AIUniwork:      s.enabled(ctx, officeAIUniworkFlag),
		TTLSeconds:     OfficeCapabilitiesTTLSeconds,
	}
	// A format is listed only when UniWork AI is on as a whole and that
	// format flag is on: a per-format switch can never widen the kill switch.
	// The list is empty when UniWork AI is off.
	out.AIUniworkFormats = []string{}
	if out.AIUniwork {
		for _, format := range officeAIUniworkFormats {
			if s.enabled(ctx, officeAIUniworkFormatPrefix+format) {
				out.AIUniworkFormats = append(out.AIUniworkFormats, format)
			}
		}
	}
	return out, nil
}

// enabled evaluates one catalogue key for ctx, taking the declared default
// from the registry so a flag added to keys.go is picked up here without a
// second list.
func (s *OfficeCapabilitiesService) enabled(ctx context.Context, key string) bool {
	def := false
	if f, ok := featureflags.Lookup(key); ok {
		def = f.Default
	}
	return s.flags.IsEnabled(ctx, key, def)
}
