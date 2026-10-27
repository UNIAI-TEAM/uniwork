package service

// Contract test for the flag keys the app capability route evaluates (plan
// X-03, GET /orgs/{orgID}/office/capabilities). The route's own handler test
// asserts behaviour through the HTTP surface; this one pins the keys
// themselves, which no HTTP assertion can see.

import (
	"context"
	"errors"
	"sync/atomic"
	"testing"
	"time"

	"github.com/unicomhub/uniwork/server/internal/auth"
	"github.com/unicomhub/uniwork/server/internal/config"
	"github.com/unicomhub/uniwork/server/internal/featureflags"
	"github.com/unicomhub/uniwork/server/internal/mail"
	"github.com/unicomhub/uniwork/server/internal/testutil"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
	"github.com/unicomhub/uniwork/server/pkg/featureflag"
)

// Every key OfficeCapabilitiesService.Get evaluates must be declared in the
// flag registry. enabled() takes the declared default when Lookup hits and
// falls back to false when it misses, so a key renamed or mistyped in
// featureflags/keys.go silently drops a capability the app asked about - and
// only the keys whose default is true would be noticed by a behavioural test,
// so a rename of office_offline_library or of one office_ai_uniwork_<format>
// would pass unnoticed. The list is derived from the service's own constants
// and format list, so renaming either side fails here.
func TestOfficeAppCapabilityFlagKeysAreDeclared(t *testing.T) {
	t.Parallel()

	evaluated := []string{
		officeSyncFeedFlag,
		officeSyncWriteFlag,
		officeOfflineLibraryFlag,
		officeAIUniworkFlag,
	}
	for _, format := range officeAIUniworkFormats {
		evaluated = append(evaluated, officeAIUniworkFormatPrefix+format)
	}

	// The exact set the route reads directly through enabled(): four
	// capability switches plus one flag per AI format (drive_connector is
	// delegated once to DriveConnectionService.AvailableForContext and pinned
	// below). A literal list, so a constant changed to a wrong name is a
	// failure here and not a silently-off capability.
	want := []string{
		"office_sync_feed",
		"office_sync_write",
		"office_offline_library",
		"office_ai_uniwork",
		"office_ai_uniwork_docx",
		"office_ai_uniwork_xlsx",
		"office_ai_uniwork_pptx",
		"office_ai_uniwork_pdf",
		"office_ai_uniwork_markdown",
		"office_ai_uniwork_html",
	}
	if len(evaluated) != len(want) {
		t.Fatalf("the route evaluates %d keys %v, want %d %v", len(evaluated), evaluated, len(want), want)
	}
	for i, key := range evaluated {
		if key != want[i] {
			t.Fatalf("key %d = %q, want %q", i, key, want[i])
		}
		if _, ok := featureflags.Lookup(key); !ok {
			t.Errorf("%s is evaluated by OfficeCapabilitiesService.Get but is not declared in the flag registry", key)
		}
	}
	if f, ok := featureflags.Lookup("drive_connector"); !ok {
		t.Error("drive_connector is delegated by OfficeCapabilitiesService.Get but is not declared in the flag registry")
	} else if !f.Default {
		t.Errorf("drive_connector default = %v, want true", f.Default)
	}
}

type trueThenFalseFlagProvider struct {
	key   string
	reads atomic.Int32
}

func (*trueThenFalseFlagProvider) Name() string { return "true-then-false" }

func (p *trueThenFalseFlagProvider) Lookup(_ context.Context, key string) (featureflag.Decision, bool) {
	if key != p.key {
		return featureflag.Decision{}, false
	}
	return featureflag.Decision{Enabled: p.reads.Add(1) == 1}, true
}

// TestOfficeAppCapabilitiesDriveConnector verifies that DriveConnector is true
// only when the drive_connector flag is enabled for the caller (user >
// organization > global) AND the Drive provider is available, that a nil
// provider reads false without panicking, and that a non-member is still
// refused by RequireMember (spec §17.1, plan B10).
func TestOfficeAppCapabilitiesDriveConnector(t *testing.T) {
	isolateDriveConnectorFlagSources(t)
	ctx := context.Background()
	pool := testutil.DB(t)
	q := db.New(pool)
	as := NewAuthService(pool, q, auth.TokenMinter{Secret: []byte("t"), TTL: time.Minute}, time.Hour, nil)
	orgs := NewOrganizationService(pool, q)
	wsSvc := NewWorkspaceService(pool, q, orgs, mail.Renderer{AppURL: "http://localhost:3000"}, &fakeOutbox{})

	owner := registerVerified(t, q, as, "office-cap-drive-owner@example.com", "Owner")
	member := registerVerified(t, q, as, "office-cap-drive-member@example.com", "Member")
	outsider := registerVerified(t, q, as, "office-cap-drive-outsider@example.com", "Outsider")

	org, err := orgs.Create(ctx, owner.ID, "Office Cap Drive", "office-cap-drive")
	if err != nil {
		t.Fatal(err)
	}
	if err := q.AddOrganizationMember(ctx, db.AddOrganizationMemberParams{
		OrganizationID: org.ID, UserID: member.ID, Role: OrgRoleMember,
	}); err != nil {
		t.Fatal(err)
	}

	box := testDriveBox(t)
	availableDrive := func() *DriveConnectionService {
		d := NewDriveConnectionService(pool, q, wsSvc, box)
		d.ConfigureOAuth(config.Config{
			AppEnv:            "development",
			FrontendOrigin:    "http://localhost:3000",
			APIPublicURL:      "https://api.example.test",
			DriveFakeProvider: true,
		})
		return d
	}

	flags, overrides, err := featureflags.NewService(q, nil)
	if err != nil {
		t.Fatal(err)
	}
	setOverride := func(scopeType, scopeID string, enabled bool) {
		t.Helper()
		if _, err := q.UpsertFlagOverride(ctx, db.UpsertFlagOverrideParams{
			ID:        "ovr-" + scopeType + "-" + scopeID,
			FlagKey:   "drive_connector",
			ScopeType: scopeType,
			ScopeID:   scopeID,
			Enabled:   enabled,
			Note:      "B10 service test",
			CreatedBy: owner.ID,
		}); err != nil {
			t.Fatal(err)
		}
		overrides.Invalidate()
	}
	clearOverride := func(scopeType, scopeID string) {
		t.Helper()
		if _, err := q.DeleteFlagOverride(ctx, db.DeleteFlagOverrideParams{
			FlagKey: "drive_connector", ScopeType: scopeType, ScopeID: scopeID,
		}); err != nil {
			t.Fatal(err)
		}
		overrides.Invalidate()
	}

	svc := NewOfficeCapabilitiesService(orgs, flags)

	// 1. Non-member is refused before any flag or provider check.
	if _, err := svc.Get(ctx, outsider.ID, org.ID); !errors.Is(err, ErrForbidden) {
		t.Fatalf("non-member err = %v, want ErrForbidden", err)
	}

	// 2. Nil provider -> false even when flag is on.
	setOverride(featureflags.ScopeGlobal, "", true)
	caps, err := svc.Get(ctx, owner.ID, org.ID)
	if err != nil {
		t.Fatal(err)
	}
	if caps.DriveConnector {
		t.Fatal("nil provider: DriveConnector = true, want false")
	}
	svc.SetDrive(nil)
	if caps, err = svc.Get(ctx, owner.ID, org.ID); err != nil || caps.DriveConnector {
		t.Fatalf("SetDrive(nil): %+v err=%v, want DriveConnector=false", caps, err)
	}
	var nilDrive *DriveConnectionService
	svc.SetDrive(nilDrive)
	caps, err = svc.Get(ctx, owner.ID, org.ID)
	if err != nil {
		t.Fatal(err)
	}
	if caps.DriveConnector {
		t.Fatal("typed-nil *DriveConnectionService: DriveConnector = true, want false")
	}

	// 3. Flag on + provider unavailable (no OAuth credentials configured) -> false.
	unavailDrive := NewDriveConnectionService(pool, q, wsSvc, box)
	unavailDrive.SetFlags(flags)
	svc.SetDrive(unavailDrive)
	caps, err = svc.Get(ctx, owner.ID, org.ID)
	if err != nil {
		t.Fatal(err)
	}
	if caps.DriveConnector {
		t.Fatal("provider unavailable: DriveConnector = true, want false")
	}

	// 4. Default (no override/env/YAML) -> true when provider available; explicit off -> false.
	clearOverride(featureflags.ScopeGlobal, "")
	driveSvc := availableDrive()
	driveSvc.SetFlags(flags)
	svc.SetDrive(driveSvc)
	caps, err = svc.Get(ctx, owner.ID, org.ID)
	if err != nil {
		t.Fatal(err)
	}
	if !caps.DriveConnector {
		t.Fatal("default (no override/env/YAML) + provider available: DriveConnector = false, want true")
	}
	setOverride(featureflags.ScopeGlobal, "", false)
	caps, err = svc.Get(ctx, owner.ID, org.ID)
	if err != nil {
		t.Fatal(err)
	}
	if caps.DriveConnector {
		t.Fatal("flag off: DriveConnector = true, want false")
	}
	// 5. Flag on (global) + provider available -> true.
	setOverride(featureflags.ScopeGlobal, "", true)
	caps, err = svc.Get(ctx, owner.ID, org.ID)
	if err != nil {
		t.Fatal(err)
	}
	if !caps.DriveConnector {
		t.Fatal("flag on + provider available: DriveConnector = false, want true")
	}

	// 6. Organization override: global off, org on -> true; org off -> false.
	setOverride(featureflags.ScopeGlobal, "", false)
	setOverride(featureflags.ScopeOrganization, org.ID, true)
	if caps, err = svc.Get(ctx, owner.ID, org.ID); err != nil || !caps.DriveConnector {
		t.Fatalf("org override on: %+v err=%v, want DriveConnector=true", caps, err)
	}
	setOverride(featureflags.ScopeOrganization, org.ID, false)
	if caps, err = svc.Get(ctx, owner.ID, org.ID); err != nil || caps.DriveConnector {
		t.Fatalf("org override off: %+v err=%v, want DriveConnector=false", caps, err)
	}
	// 7. Per-user override on for owner only -> true for owner, false for member of the same org.
	setOverride(featureflags.ScopeUser, owner.ID, true)
	ownerCaps, err := svc.Get(ctx, owner.ID, org.ID)
	if err != nil {
		t.Fatal(err)
	}
	memberCaps, err := svc.Get(ctx, member.ID, org.ID)
	if err != nil {
		t.Fatal(err)
	}
	if !ownerCaps.DriveConnector {
		t.Fatal("owner with user override on: DriveConnector = false, want true")
	}
	if memberCaps.DriveConnector {
		t.Fatal("other member of same org without user override: DriveConnector = true, want false")
	}

	// 8. Single evaluation per Get: a flag source that answers true on the
	// first drive_connector lookup and false thereafter yields DriveConnector
	// true on the first Get and false on the second.
	oneShotFlags := featureflag.NewService(&trueThenFalseFlagProvider{key: "drive_connector"})
	oneShotDrive := availableDrive()
	oneShotDrive.SetFlags(oneShotFlags)
	oneShotSvc := NewOfficeCapabilitiesService(orgs, oneShotFlags)
	oneShotSvc.SetDrive(oneShotDrive)
	firstCaps, err := oneShotSvc.Get(ctx, owner.ID, org.ID)
	if err != nil {
		t.Fatal(err)
	}
	if !firstCaps.DriveConnector {
		t.Fatal("first Get with true-then-false flag source: DriveConnector = false, want true (single evaluation per request)")
	}
	secondCaps, err := oneShotSvc.Get(ctx, owner.ID, org.ID)
	if err != nil {
		t.Fatal(err)
	}
	if secondCaps.DriveConnector {
		t.Fatal("second Get with true-then-false flag source: DriveConnector = true, want false")
	}
}
