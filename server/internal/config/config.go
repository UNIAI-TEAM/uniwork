package config

import (
	"fmt"
	"net/url"
	"os"
	"slices"
	"strconv"
	"strings"
	"time"
)

const (
	// DefaultDocumentMaxBytes is the default per-file byte ceiling for Documents
	// and Office uploads/saves (200 MiB; SIZE-S1 / UNI-1859).
	DefaultDocumentMaxBytes int64 = 200 << 20
	// MinDocumentMaxBytes and MaxDocumentMaxBytes bound DOCUMENT_MAX_BYTES to
	// [1 MiB, 2 GiB].
	MinDocumentMaxBytes int64 = 1 << 20
	MaxDocumentMaxBytes int64 = 2 << 30
	// DefaultFolderUploadMaxFiles and DefaultFolderUploadMaxBytes are the
	// folder upload limits (UNI-2052): files one PLAN may carry, and their
	// total bytes (2 GiB).
	DefaultFolderUploadMaxFiles       = 500
	DefaultFolderUploadMaxBytes int64 = 2 << 30
)

type Config struct {
	Port            string
	DatabaseURL     string
	RedisURL        string
	JWTSecret       string
	AccessTokenTTL  time.Duration
	RefreshTokenTTL time.Duration
	// Desktop auth serves public PKCE clients. Clients, their redirects and
	// deployments are explicit allowlists; an empty allowlist is rejected by
	// Load. DesktopAuthClients (DESKTOP_AUTH_CLIENTS) lists several clients,
	// each with its own redirects; when it is empty the single
	// DesktopAuthClientID + DesktopAuthRedirectURIs pair is the one client.
	// Read them through DesktopClients().
	DesktopAuthClients       []DesktopAuthClient
	DesktopAuthClientID      string
	DesktopAuthRedirectURIs  []string
	DesktopAuthDeploymentIDs []string
	DesktopAuthCodeTTL       time.Duration
	DesktopAuthAttemptTTL    time.Duration
	// DocumentCommitIntentClaimTTL, DocumentCommitIntentRetention and
	// DocumentCommitIntentSweepTick are the G5-07 intent windows and sweep
	// cadence (service.DefaultCommitIntentClaimTTL / ...Retention /
	// commitIntentSweepTick are the same dev defaults; G5-D2 fixes production).
	DocumentCommitIntentClaimTTL  time.Duration
	DocumentCommitIntentRetention time.Duration
	DocumentCommitIntentSweepTick time.Duration
	// IdempotencyKeyRetention and IdempotencyKeySweepTick are the G5-D2 §2.2
	// retention window and sweep cadence for idempotency_keys.
	IdempotencyKeyRetention time.Duration
	IdempotencyKeySweepTick time.Duration
	// DocumentMaxBytes (DOCUMENT_MAX_BYTES) is the single byte ceiling for
	// document file creates, version uploads, Office saves and exports.
	DocumentMaxBytes int64
	// FolderUploadMaxFiles (FOLDER_UPLOAD_MAX_FILES) and FolderUploadMaxBytes
	// (FOLDER_UPLOAD_MAX_BYTES) cap one folder upload PLAN (UNI-2052).
	FolderUploadMaxFiles int
	FolderUploadMaxBytes int64
	FrontendOrigin       string
	// PreviewOrigin is the separate, cookie-less origin used by isolated
	// Markdown/HTML frames. It must never be the frontend origin.
	PreviewOrigin string
	// PreviewCapabilitySecret signs short-lived, document-bound asset scopes.
	// It is deliberately separate from JWT_SECRET so a preview deployment can
	// rotate its broker credentials without logging every user out.
	PreviewCapabilitySecret string
	PreviewAssetTTL         time.Duration
	PreviewAssetMaxBytes    int64
	// OfficeChangeSnapshotTTL (OFFICE_CHANGE_SNAPSHOT_TTL) is the lifetime of
	// an Office change-feed cold-start snapshot (G5-01a); unset keeps the
	// service's dev default (15m). A value that is set must parse as a
	// positive duration: Load fails instead of silently keeping the default
	// (BE-F1-11), because a misspelled TTL that reads as 15m in production is
	// a silent data-lifecycle change. The production number is G5-D2's.
	OfficeChangeSnapshotTTL time.Duration
	// The document edit lock (UNI-1645, addendum §7). Every one of these is
	// read strictly: a value that is set and malformed fails Load, because a
	// mistyped TTL that silently behaves like the default is a lifecycle
	// change nobody asked for. Load also rejects HEARTBEAT*2 > TTL (a client
	// would miss one beat and lose the lock) and HOLD_MAX > HOLD_CHAIN_MAX.
	DocumentEditLockTTL           time.Duration
	DocumentEditLockHeartbeat     time.Duration
	DocumentEditLockSweepInterval time.Duration
	DocumentEditHoldMax           time.Duration
	DocumentEditHoldChainMax      time.Duration
	DocumentEditRequestTTL        time.Duration
	DocumentEditRequestMaxPerHour int
	// SecureCookies is derived from FrontendOrigin's scheme: an https origin
	// gets the Secure flag on the refresh cookie, a plain-http dev origin does
	// not (browsers silently drop Secure cookies set over http, which would
	// make every login on localhost look successful and then never refresh).
	SecureCookies bool
	// TrustedProxies is a comma-separated CIDR list; X-Forwarded-For is only
	// honoured for the rate limiter when the peer is inside one of them.
	TrustedProxies            string
	LiveKitURL                string
	LiveKitAPIKey             string
	LiveKitAPISecret          string
	LiveKitTokenTTL           time.Duration
	LiveKitEmptyTimeout       time.Duration
	LiveKitDepartureTimeout   time.Duration
	MeetingProvider           string
	BillingProvider           string
	VNPayTMNCode              string
	VNPayHashSecret           string
	VNPayPaymentURL           string
	VNPayMerchantAPIURL       string
	MeetingWorkerTick         time.Duration
	MeetingOutboxBatch        int32
	MeetingWebhookBatch       int32
	MeetingWebhookConcurrency int
	// AnthropicAPIKey enables AI meeting summaries; empty turns the feature off.
	AnthropicAPIKey string
	AnthropicModel  string
	// LiveKitRecordingBucket enables room recording via LiveKit Egress; the
	// AWS_* storage settings supply credentials and endpoint.
	LiveKitRecordingBucket string
	// MeetingScribeEnabled lets the server dispatch the scribe agent
	// (apps/meeting-agent, ADR 0045) into meeting rooms; the meeting_scribe
	// flag and the meeting.transcription entitlement still decide per
	// organization. MeetingScribeAgentName is the agent_name it registers.
	MeetingScribeEnabled   bool
	MeetingScribeAgentName string
	// MeetingSIPEnabled lets the server create LiveKit SIP dispatch rules for
	// dial-in (UNI-2030 runs the SIP service); the meeting_dial_in flag still
	// decides per organization. MeetingDialInNumber is the number people call;
	// MeetingSIPTrunkID, when set, keeps the rules to the UniWork trunk.
	MeetingSIPEnabled   bool
	MeetingDialInNumber string
	MeetingSIPTrunkID   string
	// MeetingSummaryMaxRunes caps the transcript a summary reads (parent spec
	// §7.8). The gateway does not expose its model's context window, so the
	// default (240k runes, ~80k tokens at ~3 runes per Vietnamese token, about
	// 2.5 hours of speech) fits a 128k-token model with room for the prompt;
	// raise it only for a model known to take more.
	MeetingSummaryMaxRunes int
	// EnableSwagger serves /swagger/* (UI + OpenAPI JSON). Off unless
	// ENABLE_SWAGGER is 1/true/yes — the spec describes the whole API
	// surface and must not ship on a public listener by default.
	EnableSwagger bool
	// AppEnv is "production" in production; the only thing it gates today is
	// the development verification code.
	AppEnv string
	// devVerificationCode is the raw DEV_VERIFICATION_CODE; read it through
	// DevVerificationCode(), which applies the production and format guards.
	devVerificationCode string
	// APIPublicURL is the origin browsers reach this API on. It builds OAuth
	// redirect URIs, which providers match byte for byte.
	APIPublicURL       string
	GoogleClientID     string
	GoogleClientSecret string
	// GoogleNativeClientIDs are the app's own Google OAuth clients, iOS and
	// Android, in the web client's Google Cloud project
	// (GOOGLE_NATIVE_CLIENT_IDS, ADR 0047 §8): an ID token the app's SDK hands
	// over must name one of them as its authorized party (azp). None keeps
	// POST /auth/native/google at 503 and /auth/providers google_native false.
	GoogleNativeClientIDs []string
	// NativeSignInClients are the public native clients the app's own sign-in
	// doors (/auth/native/*, POST /auth/apple/native) take
	// (NATIVE_SIGN_IN_CLIENTS, default uniwork-chat-mobile). Each must also be
	// a desktop auth client; the desktop apps and Office sign in through the
	// web page instead.
	NativeSignInClients []string
	// Sign in with Apple on the phone (ADR 0041): the bundle ids an identity
	// token may be issued to (APPLE_SIWA_AUDIENCES), and the team, key id
	// and .p8 key that sign the client secret Apple's token and revoke
	// endpoints take. No audiences: the route answers 503 and
	// /auth/providers reports apple=false.
	AppleSignInAudiences  []string
	AppleSignInTeamID     string
	AppleSignInKeyID      string
	AppleSignInPrivateKey string
	// Sign in with Apple on the web (ADR 0047 §7): the Services ID, grouped
	// with the app's primary App ID so a person's subject is the same on both
	// (APPLE_SIWA_WEB_CLIENT_ID). The web's identity tokens are issued to it
	// alone, and its code exchange needs the client secret the key above
	// signs: on only with both (AppleWebConfigured).
	AppleSignInWebClientID        string
	MicrosoftCalendarClientID     string
	MicrosoftCalendarClientSecret string
	// Email Hub signs in with its own OAuth clients, never the login or
	// calendar ones (spec Q3); a provider is offered only with its id, its
	// secret and EMAIL_HUB_CREDENTIAL_KEY. The tenant is the Entra directory
	// Microsoft sign-in goes to: common takes personal and work accounts.
	EmailHubGoogleClientID        string
	EmailHubGoogleClientSecret    string
	EmailHubMicrosoftClientID     string
	EmailHubMicrosoftClientSecret string
	EmailHubMicrosoftTenant       string
	// Google Drive connector (UNI-2172, spec §5.1): its own OAuth client,
	// Picker developer key and project number, and the test/dev fake switch.
	GoogleDriveClientID     string
	GoogleDriveClientSecret string
	GoogleDrivePickerAPIKey string
	GoogleDriveAppID        string
	DriveFakeProvider       bool
	SMTPHost                string
	SMTPPort                string
	SMTPUsername            string
	SMTPPassword            string
	SMTPTLS                 string
	SMTPTLSInsecure         bool
	SMTPEHLOName            string
	MailFrom                string
	// TenorAPIKey enables Tenor GIF search in chat; empty uses a small built-in catalog.
	TenorAPIKey string
	// VAPID keys enable Web Push (F-07). Both empty turns web push off: the
	// push consumer acknowledges web subscriptions without sending and the
	// client hides the option (Expo mobile push needs no VAPID). VAPID_SUBJECT is a mailto: or https origin the push service can
	// contact about abuse; it defaults to the frontend origin.
	VAPIDPublicKey  string
	VAPIDPrivateKey string
	VAPIDSubject    string
	// ExpoAccessToken authenticates mobile push to Expo Push Service when the
	// Expo project enables enhanced push security; empty sends unauthenticated.
	// Production should carry one (UnauthenticatedMobilePush), but its absence
	// is a loud log line at server start, never a boot error: every CLI that
	// calls Load (cmd/migrate among them) would refuse to run over a push
	// setting it never uses.
	ExpoAccessToken string
	// APNs token auth for iPhone VoIP pushes (ADR 0038): the .p8 key's id, the
	// Apple team id and the key itself (PEM; escaped newlines are accepted).
	// All three empty turns VoIP off and iPhones keep the Expo call push; only
	// some of them set is logged at start and also leaves VoIP off.
	// APNSVoIPTopic, when set, replaces "<bundle id>.voip" for every token.
	APNSKeyID      string
	APNSTeamID     string
	APNSPrivateKey string
	APNSVoIPTopic  string
	// RUMSampleRate is the share of web sessions that report web-vitals to
	// POST /api/v1/rum (F-11 §2.8); 0 turns reporting off client-side.
	RUMSampleRate             float64
	OfficeInstallerDevURL     string
	OfficeInstallerBetaURL    string
	OfficeInstallerStableURL  string
	OfficeInstallerDevURLs    string
	OfficeInstallerBetaURLs   string
	OfficeInstallerStableURLs string
	// UniChat downloads on the public /unichat page (UNI-1837): desktop
	// installer maps in the Office format, and the mobile store links.
	UniChatInstallerDevURLs    string
	UniChatInstallerBetaURLs   string
	UniChatInstallerStableURLs string
	UniChatStoreIOSURL         string
	UniChatStoreAndroidURL     string
	UniChatTestFlightURL       string
	UniChatPlayInternalURL     string
	// UniChatMobileMinVersion is the oldest UniChat mobile version the server
	// still serves, published as min_supported_mobile_version on
	// GET /api/v1/config: a phone below it shows "Update required". Empty
	// means no gate. Always MAJOR.MINOR.PATCH (Load refuses anything else).
	UniChatMobileMinVersion string
	// UniChatMobileRecommendedVersion is the version UniChat mobile should be
	// on, published as recommended_mobile_version: a phone below it shows a
	// dismissible "a new version is out" banner, never a block. Empty means no
	// nudge. Always MAJOR.MINOR.PATCH (Load refuses anything else).
	UniChatMobileRecommendedVersion string
	// AdminRateLimitPerMin bounds /api/v1/admin/* per IP (spec §5.2).
	AdminRateLimitPerMin int
	// HTTPMaxInFlight bounds the HTTP requests served at once; past it the
	// server sheds load with 503 + Retry-After (mw.LoadShed).
	HTTPMaxInFlight int
	// RealtimeRelay sends realtime events through Redis Streams so several
	// API nodes deliver each other's events. A single replica turns it off
	// (REALTIME_RELAY=false) and every event goes straight to the local hub.
	RealtimeRelay bool
	// FileGCMode is the FileService collector's mode (FILE_GC_MODE):
	// destructive (default) deletes unreferenced files, dry_run only reports,
	// off skips the sweep. Load rejects any other value.
	FileGCMode string
}

// UnauthenticatedMobilePush reports a production server with no Expo access
// token (audit "Security & privacy", push-preview-plaintext): its mobile pushes
// go out unauthenticated, and once the Expo project turns on enhanced push
// security Expo refuses every one of them. The server logs it at start.
func (c Config) UnauthenticatedMobilePush() bool {
	return strings.EqualFold(c.AppEnv, "production") && strings.TrimSpace(c.ExpoAccessToken) == ""
}

// PushEnabled: both VAPID keys present.
func (c Config) PushEnabled() bool {
	return c.VAPIDPublicKey != "" && c.VAPIDPrivateKey != ""
}

// DevVerificationCode is the code accepted in place of a mailed one. Empty
// unless APP_ENV is not production and the value is exactly six digits.
func (c Config) DevVerificationCode() string {
	if strings.EqualFold(c.AppEnv, "production") {
		return ""
	}
	code := strings.TrimSpace(c.devVerificationCode)
	if len(code) != 6 {
		return ""
	}
	for _, r := range code {
		if r < '0' || r > '9' {
			return ""
		}
	}
	return code
}

// GoogleEnabled: both credentials present. Without them the Google routes
// answer 503 and the login page hides the button.
func (c Config) GoogleEnabled() bool {
	return c.GoogleClientID != "" && c.GoogleClientSecret != ""
}

// GoogleNativeEnabled: the app's Google clients are named, so the app's ID
// tokens can be checked for an authorized party that is the app.
func (c Config) GoogleNativeEnabled() bool { return len(c.GoogleNativeClientIDs) > 0 }

// AppleSignInEnabled: at least one bundle id may sign in with Apple.
func (c Config) AppleSignInEnabled() bool { return len(c.AppleSignInAudiences) > 0 }

// AppleRevokeConfigured: the key that signs Apple client secrets is set, so a
// sign-in keeps a refresh token and account deletion can revoke it.
func (c Config) AppleRevokeConfigured() bool {
	return c.AppleSignInTeamID != "" && c.AppleSignInKeyID != "" && c.AppleSignInPrivateKey != ""
}

// AppleWebConfigured: the Services ID and the key that signs its client
// secret are both set. main.go turns the web's Sign in with Apple on only
// once that key also parses.
func (c Config) AppleWebConfigured() bool {
	return c.AppleSignInWebClientID != "" && c.AppleRevokeConfigured()
}

// AppleWebRedirectURL is the return URL of Sign in with Apple on the web,
// registered on the Services ID; Apple matches it byte for byte.
func (c Config) AppleWebRedirectURL() string {
	return strings.TrimRight(c.APIPublicURL, "/") + "/api/v1/auth/apple/callback"
}

func (c Config) GoogleRedirectURL() string {
	return strings.TrimRight(c.APIPublicURL, "/") + "/api/v1/auth/google/callback"
}

func (c Config) CalendarRedirectURL(provider string) string {
	return strings.TrimRight(c.APIPublicURL, "/") + "/api/v1/calendar-connections/" + provider + "/callback"
}

// DesktopAuthClient is one public PKCE client and the redirects it may use.
// A redirect is valid only for the client that lists it.
type DesktopAuthClient struct {
	ID           string
	RedirectURIs []string
}

// DesktopClients is the desktop auth client allowlist: DesktopAuthClients
// when set, otherwise the legacy single client (nil when that is empty too).
func (c Config) DesktopClients() []DesktopAuthClient {
	if len(c.DesktopAuthClients) > 0 {
		return c.DesktopAuthClients
	}
	if strings.TrimSpace(c.DesktopAuthClientID) == "" {
		return nil
	}
	return []DesktopAuthClient{{ID: c.DesktopAuthClientID, RedirectURIs: c.DesktopAuthRedirectURIs}}
}

// parseDesktopAuthClients reads DESKTOP_AUTH_CLIENTS:
// "client_id=redirect[|redirect...],client_id=...". Any malformed entry fails.
func parseDesktopAuthClients(raw string) ([]DesktopAuthClient, error) {
	var out []DesktopAuthClient
	seen := map[string]bool{}
	for _, entry := range strings.Split(raw, ",") {
		id, redirects, ok := strings.Cut(strings.TrimSpace(entry), "=")
		id = strings.TrimSpace(id)
		if !ok || id == "" || strings.ContainsAny(id, " \t|") {
			return nil, fmt.Errorf("DESKTOP_AUTH_CLIENTS entry %q must be client_id=redirect[|redirect...]", entry)
		}
		if seen[id] {
			return nil, fmt.Errorf("DESKTOP_AUTH_CLIENTS lists client %q twice", id)
		}
		seen[id] = true
		client := DesktopAuthClient{ID: id}
		for _, r := range strings.Split(redirects, "|") {
			r = strings.TrimSpace(r)
			if u, err := url.Parse(r); r == "" || err != nil || u.Scheme == "" {
				return nil, fmt.Errorf("DESKTOP_AUTH_CLIENTS redirect %q for client %q must be an absolute URI", r, id)
			}
			client.RedirectURIs = append(client.RedirectURIs, r)
		}
		out = append(out, client)
	}
	return out, nil
}

func (c Config) EmailHubRedirectURL(provider string) string {
	return strings.TrimRight(c.APIPublicURL, "/") + "/api/v1/email-hub-connections/" + provider + "/callback"
}
func (c Config) DriveGoogleRedirectURL() string {
	return strings.TrimRight(c.APIPublicURL, "/") + "/api/v1/drive-connections/google/callback"
}

// EffectiveDocumentMaxBytes returns DocumentMaxBytes, or DefaultDocumentMaxBytes
// when Config was constructed directly in a unit test with a zero value.
func (c Config) EffectiveDocumentMaxBytes() int64 {
	if c.DocumentMaxBytes > 0 {
		return c.DocumentMaxBytes
	}
	return DefaultDocumentMaxBytes
}

func Load() (Config, error) {
	// OFFICE_CHANGE_SNAPSHOT_TTL is parsed before the struct literal because a
	// set value must fail the load when malformed instead of silently keeping
	// the default (BE-F1-11); 0 keeps the service's dev default.
	changeSnapshotTTL, err := parseOptionalDuration(os.Getenv("OFFICE_CHANGE_SNAPSHOT_TTL"), 0)
	if err != nil {
		return Config{}, fmt.Errorf("OFFICE_CHANGE_SNAPSHOT_TTL %w", err)
	}
	// The edit-lock settings are parsed before the literal for the same
	// reason: set and malformed fails the load (addendum §7), unlike
	// parseDuration which would fall back to the default.
	editLockTTL, err := parseOptionalDuration(os.Getenv("DOCUMENT_EDIT_LOCK_TTL"), 2*time.Minute)
	if err != nil {
		return Config{}, fmt.Errorf("DOCUMENT_EDIT_LOCK_TTL %w", err)
	}
	editLockHeartbeat, err := parseOptionalDuration(os.Getenv("DOCUMENT_EDIT_LOCK_HEARTBEAT"), 30*time.Second)
	if err != nil {
		return Config{}, fmt.Errorf("DOCUMENT_EDIT_LOCK_HEARTBEAT %w", err)
	}
	editLockSweep, err := parseOptionalDuration(os.Getenv("DOCUMENT_EDIT_LOCK_SWEEP_INTERVAL"), 30*time.Second)
	if err != nil {
		return Config{}, fmt.Errorf("DOCUMENT_EDIT_LOCK_SWEEP_INTERVAL %w", err)
	}
	editHoldMax, err := parseOptionalDuration(os.Getenv("DOCUMENT_EDIT_HOLD_MAX"), 8*time.Hour)
	if err != nil {
		return Config{}, fmt.Errorf("DOCUMENT_EDIT_HOLD_MAX %w", err)
	}
	editHoldChainMax, err := parseOptionalDuration(os.Getenv("DOCUMENT_EDIT_HOLD_CHAIN_MAX"), 24*time.Hour)
	if err != nil {
		return Config{}, fmt.Errorf("DOCUMENT_EDIT_HOLD_CHAIN_MAX %w", err)
	}
	editRequestTTL, err := parseOptionalDuration(os.Getenv("DOCUMENT_EDIT_REQUEST_TTL"), 15*time.Minute)
	if err != nil {
		return Config{}, fmt.Errorf("DOCUMENT_EDIT_REQUEST_TTL %w", err)
	}
	editRequestMaxPerHour := 5
	if raw := strings.TrimSpace(os.Getenv("DOCUMENT_EDIT_REQUEST_MAX_PER_HOUR")); raw != "" {
		n, convErr := strconv.Atoi(raw)
		if convErr != nil || n <= 0 {
			return Config{}, fmt.Errorf("DOCUMENT_EDIT_REQUEST_MAX_PER_HOUR must be a positive integer, got %q", raw)
		}
		editRequestMaxPerHour = n
	}
	if editLockHeartbeat*2 > editLockTTL {
		return Config{}, fmt.Errorf("DOCUMENT_EDIT_LOCK_HEARTBEAT must be at most half of DOCUMENT_EDIT_LOCK_TTL")
	}
	if editHoldMax > editHoldChainMax {
		return Config{}, fmt.Errorf("DOCUMENT_EDIT_HOLD_MAX must not exceed DOCUMENT_EDIT_HOLD_CHAIN_MAX")
	}
	documentMaxBytes, err := parseDocumentMaxBytes(os.Getenv("DOCUMENT_MAX_BYTES"))
	if err != nil {
		return Config{}, err
	}
	// A typo here would silently switch the mobile version gate off, so a set
	// value that is not MAJOR.MINOR.PATCH fails the load.
	mobileMinVersion, err := parseMobileVersion(os.Getenv("UNICHAT_MOBILE_MIN_SUPPORTED_VERSION"))
	if err != nil {
		return Config{}, fmt.Errorf("UNICHAT_MOBILE_MIN_SUPPORTED_VERSION %w", err)
	}
	mobileRecommendedVersion, err := parseMobileVersion(os.Getenv("UNICHAT_MOBILE_RECOMMENDED_VERSION"))
	if err != nil {
		return Config{}, fmt.Errorf("UNICHAT_MOBILE_RECOMMENDED_VERSION %w", err)
	}
	folderUploadMaxFiles, err := parsePositiveInt64("FOLDER_UPLOAD_MAX_FILES", os.Getenv("FOLDER_UPLOAD_MAX_FILES"), DefaultFolderUploadMaxFiles)
	if err != nil {
		return Config{}, err
	}
	folderUploadMaxBytes, err := parsePositiveInt64("FOLDER_UPLOAD_MAX_BYTES", os.Getenv("FOLDER_UPLOAD_MAX_BYTES"), DefaultFolderUploadMaxBytes)
	if err != nil {
		return Config{}, err
	}
	driveFakeRaw := strings.TrimSpace(os.Getenv("DRIVE_FAKE_PROVIDER"))
	driveFakeProvider := driveFakeRaw == "1" || strings.EqualFold(driveFakeRaw, "true")
	c := Config{
		Port:                          getenv("PORT", "8080"),
		DatabaseURL:                   os.Getenv("DATABASE_URL"),
		RedisURL:                      os.Getenv("REDIS_URL"),
		JWTSecret:                     os.Getenv("JWT_SECRET"),
		AccessTokenTTL:                15 * time.Minute,
		RefreshTokenTTL:               30 * 24 * time.Hour,
		DesktopAuthClientID:           getenv("DESKTOP_AUTH_CLIENT_ID", "uniwork-office"),
		DesktopAuthRedirectURIs:       splitList(getenv("DESKTOP_AUTH_REDIRECT_URIS", "uniwork-office://auth/callback")),
		DesktopAuthDeploymentIDs:      splitList(getenv("DESKTOP_AUTH_DEPLOYMENT_IDS", "default")),
		DesktopAuthCodeTTL:            parseDuration(os.Getenv("DESKTOP_AUTH_CODE_TTL"), 120*time.Second),
		DesktopAuthAttemptTTL:         parseDuration(os.Getenv("DESKTOP_AUTH_ATTEMPT_TTL"), 10*time.Minute),
		DocumentCommitIntentClaimTTL:  parseDuration(os.Getenv("DOCUMENT_COMMIT_INTENT_CLAIM_TTL"), 2*time.Minute),
		DocumentCommitIntentRetention: parseDuration(os.Getenv("DOCUMENT_COMMIT_INTENT_RETENTION"), 7*24*time.Hour),
		DocumentCommitIntentSweepTick: parseDuration(os.Getenv("DOCUMENT_COMMIT_INTENT_SWEEP_TICK"), 10*time.Minute),
		IdempotencyKeyRetention:       parseDuration(os.Getenv("IDEMPOTENCY_KEY_RETENTION"), 7*24*time.Hour),
		IdempotencyKeySweepTick:       parseDuration(os.Getenv("IDEMPOTENCY_KEY_SWEEP_TICK"), 10*time.Minute),
		DocumentMaxBytes:              documentMaxBytes,
		FolderUploadMaxFiles:          int(folderUploadMaxFiles),
		FolderUploadMaxBytes:          folderUploadMaxBytes,
		FrontendOrigin:                getenv("FRONTEND_ORIGIN", "http://localhost:3000"),
		PreviewOrigin:                 os.Getenv("PREVIEW_ORIGIN"),
		PreviewCapabilitySecret:       os.Getenv("PREVIEW_CAPABILITY_SECRET"),
		PreviewAssetTTL:               parseRequiredDuration(os.Getenv("PREVIEW_ASSET_TTL")),
		PreviewAssetMaxBytes:          parseRequiredInt64(os.Getenv("PREVIEW_ASSET_MAX_BYTES")),
		OfficeChangeSnapshotTTL:       changeSnapshotTTL,
		DocumentEditLockTTL:           editLockTTL,
		DocumentEditLockHeartbeat:     editLockHeartbeat,
		DocumentEditLockSweepInterval: editLockSweep,
		DocumentEditHoldMax:           editHoldMax,
		DocumentEditHoldChainMax:      editHoldChainMax,
		DocumentEditRequestTTL:        editRequestTTL,
		DocumentEditRequestMaxPerHour: editRequestMaxPerHour,
		TrustedProxies:                os.Getenv("TRUSTED_PROXIES"),
		LiveKitURL:                    os.Getenv("LIVEKIT_URL"),
		LiveKitAPIKey:                 os.Getenv("LIVEKIT_API_KEY"),
		LiveKitAPISecret:              os.Getenv("LIVEKIT_API_SECRET"),
		LiveKitTokenTTL:               parseDuration(os.Getenv("LIVEKIT_TOKEN_TTL"), 30*time.Minute),
		LiveKitEmptyTimeout:           parseDuration(os.Getenv("LIVEKIT_ROOM_EMPTY_TIMEOUT"), 0),
		LiveKitDepartureTimeout:       parseDuration(os.Getenv("LIVEKIT_ROOM_DEPARTURE_TIMEOUT"), 20*time.Second),
		MeetingProvider:               getenv("MEETING_PROVIDER", "livekit"),
		BillingProvider:               getenv("BILLING_PROVIDER", "manual"),
		VNPayTMNCode:                  os.Getenv("VNPAY_TMN_CODE"),
		VNPayHashSecret:               os.Getenv("VNPAY_HASH_SECRET"),
		VNPayPaymentURL:               getenv("VNPAY_PAYMENT_URL", "https://sandbox.vnpayment.vn/paymentv2/vpcpay.html"),
		VNPayMerchantAPIURL:           os.Getenv("VNPAY_MERCHANT_API_URL"),
		MeetingWorkerTick:             parseDuration(os.Getenv("MEETING_WORKER_TICK"), time.Second),
		MeetingOutboxBatch:            parseInt32(os.Getenv("MEETING_OUTBOX_BATCH"), 50),
		MeetingWebhookBatch:           parseInt32(os.Getenv("MEETING_WEBHOOK_BATCH"), 50),
		MeetingWebhookConcurrency:     int(parseInt32(os.Getenv("MEETING_WEBHOOK_CONCURRENCY"), 8)),
		AnthropicAPIKey:               os.Getenv("ANTHROPIC_API_KEY"),
		AnthropicModel:                os.Getenv("ANTHROPIC_MODEL"),
		LiveKitRecordingBucket:        os.Getenv("LIVEKIT_RECORDING_BUCKET"),
		MeetingScribeEnabled:          strings.EqualFold(os.Getenv("MEETING_SCRIBE_ENABLED"), "true"),
		MeetingScribeAgentName:        getenv("MEETING_SCRIBE_AGENT_NAME", "uniwork-scribe"),
		MeetingSIPEnabled:             strings.EqualFold(os.Getenv("MEETING_SIP_ENABLED"), "true"),
		MeetingDialInNumber:           strings.TrimSpace(os.Getenv("MEETING_DIAL_IN_NUMBER")),
		MeetingSIPTrunkID:             strings.TrimSpace(os.Getenv("MEETING_SIP_TRUNK_ID")),
		MeetingSummaryMaxRunes:        int(parseInt32(os.Getenv("MEETING_SUMMARY_MAX_RUNES"), 240000)),
		AppEnv:                        getenv("APP_ENV", "development"),
		devVerificationCode:           os.Getenv("DEV_VERIFICATION_CODE"),
		APIPublicURL:                  getenv("API_PUBLIC_URL", "http://localhost:8080"),
		GoogleClientID:                os.Getenv("GOOGLE_CLIENT_ID"),
		GoogleClientSecret:            os.Getenv("GOOGLE_CLIENT_SECRET"),
		GoogleNativeClientIDs:         splitList(os.Getenv("GOOGLE_NATIVE_CLIENT_IDS")),
		NativeSignInClients:           splitList(getenv("NATIVE_SIGN_IN_CLIENTS", "uniwork-chat-mobile")),
		AppleSignInAudiences:          splitList(os.Getenv("APPLE_SIWA_AUDIENCES")),
		AppleSignInTeamID:             os.Getenv("APPLE_SIWA_TEAM_ID"),
		AppleSignInKeyID:              os.Getenv("APPLE_SIWA_KEY_ID"),
		AppleSignInPrivateKey:         os.Getenv("APPLE_SIWA_PRIVATE_KEY"),
		AppleSignInWebClientID:        strings.TrimSpace(os.Getenv("APPLE_SIWA_WEB_CLIENT_ID")),
		MicrosoftCalendarClientID:     os.Getenv("MICROSOFT_CALENDAR_CLIENT_ID"),
		MicrosoftCalendarClientSecret: os.Getenv("MICROSOFT_CALENDAR_CLIENT_SECRET"),
		EmailHubGoogleClientID:        os.Getenv("EMAIL_HUB_GOOGLE_CLIENT_ID"),
		EmailHubGoogleClientSecret:    os.Getenv("EMAIL_HUB_GOOGLE_CLIENT_SECRET"),
		EmailHubMicrosoftClientID:     os.Getenv("EMAIL_HUB_MICROSOFT_CLIENT_ID"),
		EmailHubMicrosoftClientSecret: os.Getenv("EMAIL_HUB_MICROSOFT_CLIENT_SECRET"),
		EmailHubMicrosoftTenant:       getenv("EMAIL_HUB_MICROSOFT_TENANT", "common"),
		GoogleDriveClientID:           os.Getenv("GOOGLE_DRIVE_CLIENT_ID"),
		GoogleDriveClientSecret:       os.Getenv("GOOGLE_DRIVE_CLIENT_SECRET"),
		GoogleDrivePickerAPIKey:       os.Getenv("GOOGLE_DRIVE_PICKER_API_KEY"),
		GoogleDriveAppID:              os.Getenv("GOOGLE_DRIVE_APP_ID"),
		DriveFakeProvider:             driveFakeProvider,
		SMTPHost:                      os.Getenv("SMTP_HOST"),
		SMTPPort:                      getenv("SMTP_PORT", "25"),
		SMTPUsername:                  os.Getenv("SMTP_USERNAME"),
		SMTPPassword:                  os.Getenv("SMTP_PASSWORD"),
		SMTPTLS:                       os.Getenv("SMTP_TLS"),
		SMTPTLSInsecure:               strings.EqualFold(os.Getenv("SMTP_TLS_INSECURE"), "true"),
		SMTPEHLOName:                  os.Getenv("SMTP_EHLO_NAME"),
		MailFrom:                      getenv("MAIL_FROM", "UniWork <noreply@unicomhub.com>"),
		TenorAPIKey:                   os.Getenv("TENOR_API_KEY"),
		VAPIDPublicKey:                os.Getenv("VAPID_PUBLIC_KEY"),
		VAPIDPrivateKey:               os.Getenv("VAPID_PRIVATE_KEY"),
		VAPIDSubject:                  os.Getenv("VAPID_SUBJECT"),
		ExpoAccessToken:               os.Getenv("EXPO_ACCESS_TOKEN"),
		APNSKeyID:                     os.Getenv("APNS_KEY_ID"),
		APNSTeamID:                    os.Getenv("APNS_TEAM_ID"),
		APNSPrivateKey:                os.Getenv("APNS_PRIVATE_KEY"),
		APNSVoIPTopic:                 os.Getenv("APNS_VOIP_TOPIC"),
		RUMSampleRate:                 parseRatio(os.Getenv("RUM_SAMPLE_RATE"), 0.2),
		OfficeInstallerDevURL:         os.Getenv("OFFICE_INSTALLER_DEV_URL"),
		OfficeInstallerBetaURL:        os.Getenv("OFFICE_INSTALLER_BETA_URL"),
		OfficeInstallerStableURL:      os.Getenv("OFFICE_INSTALLER_STABLE_URL"),
		OfficeInstallerDevURLs:        os.Getenv("OFFICE_INSTALLER_DEV_URLS"),
		OfficeInstallerBetaURLs:       os.Getenv("OFFICE_INSTALLER_BETA_URLS"),
		OfficeInstallerStableURLs:     os.Getenv("OFFICE_INSTALLER_STABLE_URLS"),
		UniChatInstallerDevURLs:       os.Getenv("UNICHAT_INSTALLER_DEV_URLS"),
		UniChatInstallerBetaURLs:      os.Getenv("UNICHAT_INSTALLER_BETA_URLS"),
		UniChatInstallerStableURLs:    os.Getenv("UNICHAT_INSTALLER_STABLE_URLS"),
		UniChatStoreIOSURL:            os.Getenv("UNICHAT_STORE_IOS_URL"),
		UniChatStoreAndroidURL:        os.Getenv("UNICHAT_STORE_ANDROID_URL"),
		UniChatTestFlightURL:          os.Getenv("UNICHAT_TESTFLIGHT_URL"),
		UniChatPlayInternalURL:        os.Getenv("UNICHAT_PLAY_INTERNAL_URL"),
		UniChatMobileMinVersion:       mobileMinVersion,
		AdminRateLimitPerMin:          int(parseInt32(os.Getenv("ADMIN_RATE_LIMIT_PER_MIN"), 60)),
		HTTPMaxInFlight:               int(parseInt32(os.Getenv("HTTP_MAX_IN_FLIGHT"), 128)),
		RealtimeRelay:                 !strings.EqualFold(strings.TrimSpace(os.Getenv("REALTIME_RELAY")), "false"),
		FileGCMode:                    strings.ToLower(strings.TrimSpace(getenv("FILE_GC_MODE", "destructive"))),
	}
	c.UniChatMobileRecommendedVersion = mobileRecommendedVersion
	switch c.FileGCMode {
	case "destructive", "dry_run", "off":
	default:
		return c, fmt.Errorf("FILE_GC_MODE must be destructive, dry_run or off, got %q", c.FileGCMode)
	}
	if c.VAPIDSubject == "" {
		c.VAPIDSubject = c.FrontendOrigin
	}
	if c.DatabaseURL == "" {
		return c, fmt.Errorf("DATABASE_URL is required")
	}
	if c.AppleSignInWebClientID != "" && slices.Contains(c.AppleSignInAudiences, c.AppleSignInWebClientID) {
		// The two doors verify tokens for different audiences (ADR 0047 §7):
		// listed in both, a token the web was issued would open the app's.
		return c, fmt.Errorf("APPLE_SIWA_WEB_CLIENT_ID %q must not be listed in APPLE_SIWA_AUDIENCES: the web and the app take tokens for different audiences", c.AppleSignInWebClientID)
	}
	if c.GoogleClientID != "" && slices.Contains(c.GoogleNativeClientIDs, c.GoogleClientID) {
		// The app's door takes only an app client as the authorized party
		// (ADR 0047 §8): listed there, the web client's tokens would open it.
		return c, fmt.Errorf("GOOGLE_CLIENT_ID %q must not be listed in GOOGLE_NATIVE_CLIENT_IDS: the web and the app take tokens issued to different clients", c.GoogleClientID)
	}
	if c.JWTSecret == "" {
		return c, fmt.Errorf("JWT_SECRET is required")
	}
	if raw := strings.TrimSpace(os.Getenv("DESKTOP_AUTH_CLIENTS")); raw != "" {
		// One allowlist at a time: a leftover single-client pair beside the
		// list would otherwise be silently ignored.
		if os.Getenv("DESKTOP_AUTH_CLIENT_ID") != "" || os.Getenv("DESKTOP_AUTH_REDIRECT_URIS") != "" {
			return c, fmt.Errorf("set either DESKTOP_AUTH_CLIENTS or DESKTOP_AUTH_CLIENT_ID/DESKTOP_AUTH_REDIRECT_URIS, not both")
		}
		clients, err := parseDesktopAuthClients(raw)
		if err != nil {
			return c, err
		}
		c.DesktopAuthClients = clients
		c.DesktopAuthClientID, c.DesktopAuthRedirectURIs = "", nil
	}
	if len(c.DesktopClients()) == 0 || len(c.DesktopClients()[0].RedirectURIs) == 0 || len(c.DesktopAuthDeploymentIDs) == 0 {
		return c, fmt.Errorf("desktop auth client, redirect and deployment allowlists are required")
	}
	if c.DesktopAuthCodeTTL <= 0 || c.DesktopAuthCodeTTL > 10*time.Minute {
		return c, fmt.Errorf("DESKTOP_AUTH_CODE_TTL must be between 1s and 10m")
	}
	if c.DesktopAuthAttemptTTL <= 0 || c.DesktopAuthAttemptTTL > time.Hour {
		return c, fmt.Errorf("DESKTOP_AUTH_ATTEMPT_TTL must be between 1s and 1h")
	}
	u, err := url.Parse(c.FrontendOrigin)
	if err != nil || !isHTTPOrigin(u) {
		return c, fmt.Errorf("FRONTEND_ORIGIN must be an absolute origin like https://app.example.com, got %q", c.FrontendOrigin)
	}
	p, err := url.Parse(c.PreviewOrigin)
	if err != nil || !isHTTPOrigin(p) {
		return c, fmt.Errorf("PREVIEW_ORIGIN must be an absolute http(s) origin, got %q", c.PreviewOrigin)
	}
	if strings.EqualFold(p.Scheme, u.Scheme) && strings.EqualFold(p.Host, u.Host) {
		return c, fmt.Errorf("PREVIEW_ORIGIN must be different from FRONTEND_ORIGIN")
	}
	if len(strings.TrimSpace(c.PreviewCapabilitySecret)) < 32 {
		return c, fmt.Errorf("PREVIEW_CAPABILITY_SECRET must be at least 32 characters")
	}
	if c.PreviewAssetTTL <= 0 || c.PreviewAssetTTL > time.Hour {
		return c, fmt.Errorf("PREVIEW_ASSET_TTL must be between 1s and 1h")
	}
	if c.PreviewAssetMaxBytes <= 0 {
		return c, fmt.Errorf("PREVIEW_ASSET_MAX_BYTES must be positive")
	}
	c.SecureCookies = strings.EqualFold(u.Scheme, "https")
	if a, err := url.Parse(c.APIPublicURL); err != nil || a.Scheme == "" || a.Host == "" {
		return c, fmt.Errorf("API_PUBLIC_URL must be an absolute origin like https://api.example.com, got %q", c.APIPublicURL)
	}
	if strings.EqualFold(c.AppEnv, "production") && (c.DriveFakeProvider || (driveFakeRaw != "" && driveFakeRaw != "0" && !strings.EqualFold(driveFakeRaw, "false"))) {
		return c, fmt.Errorf("DRIVE_FAKE_PROVIDER is refused when APP_ENV=production")
	}
	// Swagger is opt-in in production (ENABLE_SWAGGER=1). Locally it is on
	// unless the operator sets ENABLE_SWAGGER=0: GNU Make 3.81 (macOS stock)
	// also drops a last .env line that has no trailing newline, so a
	// localhost default is the only reliable local path.
	c.EnableSwagger = swaggerEnabled(c.FrontendOrigin)
	return c, nil
}

func isHTTPOrigin(u *url.URL) bool {
	return u != nil && (strings.EqualFold(u.Scheme, "http") || strings.EqualFold(u.Scheme, "https")) && u.Host != "" && (u.Path == "" || u.Path == "/") && u.RawQuery == "" && u.Fragment == "" && u.User == nil
}

func getenv(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}

func parseDuration(raw string, fallback time.Duration) time.Duration {
	if raw == "" {
		return fallback
	}
	d, err := time.ParseDuration(raw)
	if err != nil || d <= 0 {
		return fallback
	}
	return d
}

// parseOptionalDuration reads a duration that has a default: unset keeps the
// default, but a value that is set must be a positive duration (BE-F1-11).
// A misspelled TTL must fail Load, not silently behave like the default.
func parseOptionalDuration(raw string, fallback time.Duration) (time.Duration, error) {
	if strings.TrimSpace(raw) == "" {
		return fallback, nil
	}
	d, err := time.ParseDuration(strings.TrimSpace(raw))
	if err != nil || d <= 0 {
		return 0, fmt.Errorf("must be a positive duration like 15m, got %q", raw)
	}
	return d, nil
}

func parseRequiredDuration(raw string) time.Duration {
	if strings.TrimSpace(raw) == "" {
		return 0
	}
	d, err := time.ParseDuration(strings.TrimSpace(raw))
	if err != nil || d <= 0 {
		return 0
	}
	return d
}

func parseRequiredInt64(raw string) int64 {
	if strings.TrimSpace(raw) == "" {
		return 0
	}
	var n int64
	if _, err := fmt.Sscan(strings.TrimSpace(raw), &n); err != nil || n <= 0 {
		return 0
	}
	return n
}

func parseDocumentMaxBytes(raw string) (int64, error) {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return DefaultDocumentMaxBytes, nil
	}
	n, err := strconv.ParseInt(trimmed, 10, 64)
	if err != nil || n < MinDocumentMaxBytes || n > MaxDocumentMaxBytes {
		return 0, fmt.Errorf("DOCUMENT_MAX_BYTES must be an integer between %d (1 MiB) and %d (2 GiB), got %q", MinDocumentMaxBytes, MaxDocumentMaxBytes, raw)
	}
	return n, nil
}

// parsePositiveInt64 reads a positive integer, fallback when unset; anything
// else stops the server at boot instead of running with a limit nobody set.
func parsePositiveInt64(name, raw string, fallback int64) (int64, error) {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return fallback, nil
	}
	n, err := strconv.ParseInt(trimmed, 10, 64)
	if err != nil || n <= 0 {
		return 0, fmt.Errorf("%s must be a positive integer, got %q", name, raw)
	}
	return n, nil
}

func parseRatio(raw string, fallback float64) float64 {
	if raw == "" {
		return fallback
	}
	var f float64
	if _, err := fmt.Sscanf(raw, "%g", &f); err != nil || f < 0 || f > 1 {
		return fallback
	}
	return f
}

func parseInt32(raw string, fallback int32) int32 {
	if raw == "" {
		return fallback
	}
	var n int
	_, err := fmt.Sscanf(raw, "%d", &n)
	if err != nil || n <= 0 {
		return fallback
	}
	return int32(n)
}

func splitList(raw string) []string {
	parts := strings.Split(raw, ",")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		if p = strings.TrimSpace(p); p != "" {
			out = append(out, p)
		}
	}
	return out
}

func swaggerEnabled(frontendOrigin string) bool {
	raw := strings.ToLower(strings.TrimSpace(os.Getenv("ENABLE_SWAGGER")))
	switch raw {
	case "1", "true", "yes":
		return true
	case "0", "false", "no":
		return false
	case "":
		return isLocalDevOrigin(frontendOrigin)
	default:
		return false
	}
}

func isLocalDevOrigin(origin string) bool {
	u, err := url.Parse(origin)
	if err != nil {
		return false
	}
	switch strings.ToLower(u.Hostname()) {
	case "localhost", "127.0.0.1", "::1":
		return true
	default:
		return false
	}
}
