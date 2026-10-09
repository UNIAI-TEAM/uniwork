package service

import (
	"context"
	"encoding/base64"
	"errors"
	"net/http"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/unicomhub/uniwork/server/internal/ai"
	"github.com/unicomhub/uniwork/server/internal/ai/provider"
)

// AICloudService is the organization-tier door to the UniWork cloud tools
// (GO-A7, ADR 0029): search, image generation, media analysis and
// transcription for Office, paid in ai.tokens credits. Order on every call:
// membership → office.ai_cloud → input → tool configured → credits → gateway.
// Media arrives as bytes from the client; nothing here fetches a URL.
type AICloudService struct {
	orgs *OrganizationService
	ent  *EntitlementService
	gw   *ai.Gateway
	now  func() time.Time
}

func NewAICloudService(orgs *OrganizationService, ent *EntitlementService, gw *ai.Gateway) *AICloudService {
	return &AICloudService{orgs: orgs, ent: ent, gw: gw, now: time.Now}
}

// Input limits (contract "UniWork cloud tools"). Sizes are decoded bytes.
const (
	cloudQueryMaxRunes      = 400
	cloudPromptMaxRunes     = 4000
	cloudMaxResultsDefault  = 6
	cloudMaxResults         = 10
	cloudMaxReferenceImages = 4
	cloudReferenceMaxBytes  = 8 << 20
	cloudMaxMedia           = 4
	cloudMediaMaxBytes      = 25 << 20
	cloudAudioMaxBytes      = 25 << 20
)

var errCreditsExhausted = CodedError{Code: "credits_exhausted", Status: http.StatusPaymentRequired, Err: ErrQuotaExceeded,
	Msg: "tổ chức đã dùng hết credit AI của kỳ này", Fields: map[string]any{"meter": FeatureAITokens}}

// CloudMedia is one file the client sends, base64 in JSON.
type CloudMedia struct {
	MIME       string
	DataBase64 string
}

type CloudCredits struct {
	Used      int64
	Limit     *int64
	Remaining *int64
	PeriodEnd *time.Time
}

type AICloudStatus struct {
	Enabled bool
	// Reason says why Enabled is false: entitlement_required,
	// subscription_inactive or cloud_unavailable.
	Reason  string
	Tools   ai.CloudAvailability
	Credits CloudCredits
}

// Status never refuses a member: a plan without office.ai_cloud reads as
// enabled=false with the reason, so the client can explain instead of hide.
func (s *AICloudService) Status(ctx context.Context, userID, orgID string) (AICloudStatus, error) {
	if _, err := s.orgs.RequireMember(ctx, orgID, userID); err != nil {
		return AICloudStatus{}, err
	}
	var out AICloudStatus
	if err := s.ent.Can(ctx, orgID, FeatureOfficeAICloud); err != nil {
		var ce CodedError
		if !errors.As(err, &ce) {
			return AICloudStatus{}, err
		}
		out.Reason = ce.Code
	} else {
		out.Tools = s.gw.CloudAvailability()
		t := out.Tools
		out.Enabled = t.WebSearch || t.ImageSearch || t.ImageGenerate || t.MediaAnalyze || t.Transcribe
		if !out.Enabled {
			out.Reason = ai.ErrCloudUnavailable.Code
		}
	}
	out.Credits = s.credits(ctx, orgID)
	return out, nil
}

// credits is the ai.tokens meter of the current period. A billing read that
// fails leaves the numbers unknown rather than failing the status.
func (s *AICloudService) credits(ctx context.Context, orgID string) CloudCredits {
	var c CloudCredits
	snap, err := s.ent.Snapshot(ctx, orgID)
	if err != nil {
		return c
	}
	if snap.Subscription.CurrentPeriodEnd.Valid {
		end := snap.Subscription.CurrentPeriodEnd.Time.UTC()
		c.PeriodEnd = &end
	}
	for _, e := range snap.Entitlements {
		if e.Key != FeatureAITokens {
			continue
		}
		c.Used = e.Current
		if e.Limit != nil {
			limit, left := *e.Limit, *e.Limit-e.Current
			if !e.Enabled {
				limit, left = 0, 0
			}
			if left < 0 {
				left = 0
			}
			c.Limit, c.Remaining = &limit, &left
		}
	}
	return c
}

// gate is membership then the office.ai_cloud flag; it runs before any input
// is looked at so a non-member learns nothing from a validation message.
func (s *AICloudService) gate(ctx context.Context, userID, orgID string) error {
	if _, err := s.orgs.RequireMember(ctx, orgID, userID); err != nil {
		return err
	}
	return s.ent.Can(ctx, orgID, FeatureOfficeAICloud)
}

// charge checks the credits would cover cost before the vendor is asked.
func (s *AICloudService) charge(ctx context.Context, orgID string, cost int64) error {
	err := s.ent.CheckQuota(ctx, orgID, FeatureAITokens, cost)
	if errors.Is(err, ErrQuotaExceeded) || errors.Is(err, ErrEntitlementRequired) || errors.Is(err, ErrSubscriptionInactive) {
		return errCreditsExhausted
	}
	return err
}

// gatewayErr turns the gateway's own quota refusal into the same 402 the
// pre-check answers.
func gatewayErr(err error) error {
	if errors.Is(err, ai.ErrQuotaExceeded) {
		return errCreditsExhausted
	}
	return err
}

func (s *AICloudService) call(userID, orgID string) ai.CloudCall {
	return ai.CloudCall{Actor: Human(userID), OrganizationID: orgID}
}

type CloudSearchInput struct {
	Query      string
	Kind       string
	MaxResults int
}

func (s *AICloudService) Search(ctx context.Context, userID, orgID string, in CloudSearchInput) (provider.SearchResponse, error) {
	if err := s.gate(ctx, userID, orgID); err != nil {
		return provider.SearchResponse{}, err
	}
	q := strings.TrimSpace(in.Query)
	if q == "" || utf8.RuneCountInString(q) > cloudQueryMaxRunes {
		return provider.SearchResponse{}, Invalid("query phải có từ 1 đến 400 ký tự")
	}
	kind := in.Kind
	if kind == "" {
		kind = "web"
	}
	if kind != "web" && kind != "image" {
		return provider.SearchResponse{}, Invalid("kind phải là web hoặc image")
	}
	n := in.MaxResults
	if n == 0 {
		n = cloudMaxResultsDefault
	}
	if n < 1 || n > cloudMaxResults {
		return provider.SearchResponse{}, Invalid("max_results phải từ 1 đến 10")
	}
	if !s.gw.CloudAvailability().WebSearch {
		return provider.SearchResponse{}, ai.ErrCloudUnavailable
	}
	if err := s.charge(ctx, orgID, ai.CloudSearchTokens); err != nil {
		return provider.SearchResponse{}, err
	}
	res, err := s.gw.CloudSearch(ctx, s.call(userID, orgID), provider.SearchRequest{Query: q, Kind: kind, MaxResults: n})
	if err != nil {
		return provider.SearchResponse{}, gatewayErr(err)
	}
	if len(res.Results) > n {
		res.Results = res.Results[:n]
	}
	return res, nil
}

type CloudImageInput struct {
	Prompt          string
	AspectRatio     string
	ImageSize       string
	ReferenceImages []CloudMedia
}

func (s *AICloudService) GenerateImage(ctx context.Context, userID, orgID string, in CloudImageInput) (provider.ImageResponse, error) {
	if err := s.gate(ctx, userID, orgID); err != nil {
		return provider.ImageResponse{}, err
	}
	prompt := strings.TrimSpace(in.Prompt)
	if prompt == "" || utf8.RuneCountInString(prompt) > cloudPromptMaxRunes {
		return provider.ImageResponse{}, Invalid("prompt phải có từ 1 đến 4000 ký tự")
	}
	if len(in.ReferenceImages) > cloudMaxReferenceImages {
		return provider.ImageResponse{}, Invalid("tối đa 4 ảnh tham chiếu")
	}
	refs := make([]provider.Part, 0, len(in.ReferenceImages))
	for _, m := range in.ReferenceImages {
		if !imageMIME(m.MIME) {
			return provider.ImageResponse{}, Invalid("ảnh tham chiếu phải là PNG, JPEG hoặc WebP")
		}
		p, err := decodeMedia(m, cloudReferenceMaxBytes, "mỗi ảnh tham chiếu tối đa 8 MiB")
		if err != nil {
			return provider.ImageResponse{}, err
		}
		refs = append(refs, p)
	}
	if !s.gw.CloudAvailability().ImageGenerate {
		return provider.ImageResponse{}, ai.ErrCloudUnavailable
	}
	if err := s.charge(ctx, orgID, ai.CloudImageTokensPerImage); err != nil {
		return provider.ImageResponse{}, err
	}
	res, err := s.gw.CloudImage(ctx, s.call(userID, orgID), provider.ImageRequest{
		Prompt: prompt, Size: imageSize(in.ImageSize, in.AspectRatio), ReferenceImages: refs,
	})
	if err != nil {
		return provider.ImageResponse{}, gatewayErr(err)
	}
	return res, nil
}

type CloudAnalyzeInput struct {
	Requirements string
	Locale       string
	Media        []CloudMedia
}

func (s *AICloudService) AnalyzeMedia(ctx context.Context, userID, orgID string, in CloudAnalyzeInput) (string, error) {
	if err := s.gate(ctx, userID, orgID); err != nil {
		return "", err
	}
	req := strings.TrimSpace(in.Requirements)
	if req == "" || utf8.RuneCountInString(req) > cloudPromptMaxRunes {
		return "", Invalid("requirements phải có từ 1 đến 4000 ký tự")
	}
	if len(in.Media) == 0 || len(in.Media) > cloudMaxMedia {
		return "", Invalid("media phải có từ 1 đến 4 tệp")
	}
	parts := make([]provider.Part, 0, len(in.Media))
	mimes := make([]string, 0, len(in.Media))
	total := 0
	for _, m := range in.Media {
		if strings.TrimSpace(m.MIME) == "" {
			return "", Invalid("mỗi tệp cần mime")
		}
		// Only allowlisted types go further, so the value that reaches the
		// prompt below is one of our own constants, never client text.
		mime, ok := analyzeMIME(m.MIME)
		if !ok {
			return "", ai.ErrMediaUnsupported
		}
		p, err := decodeMedia(m, cloudMediaMaxBytes, "tổng dung lượng media tối đa 25 MiB")
		if err != nil {
			return "", err
		}
		if total += len(p.Data); total > cloudMediaMaxBytes {
			return "", Invalid("tổng dung lượng media tối đa 25 MiB")
		}
		parts = append(parts, p)
		mimes = append(mimes, mime)
	}
	if !s.gw.CloudAvailability().MediaAnalyze {
		return "", ai.ErrCloudUnavailable
	}
	if err := s.charge(ctx, orgID, 1); err != nil {
		return "", err
	}
	locale := in.Locale
	if locale == "" {
		locale = "vi"
	}
	resp, err := s.gw.Complete(ctx, ai.Request{
		Actor: Human(userID), OrganizationID: orgID, Capability: ai.CapMediaAnalysis, PromptID: ai.PromptMediaAnalysis,
		Vars:        map[string]any{"requirements": req, "locale": locale, "files": strings.Join(mimes, ", ")},
		Attachments: parts,
	})
	if err != nil {
		return "", gatewayErr(err)
	}
	return ai.ParseMediaAnalysisJSON(resp.Text).Text, nil
}

type CloudTranscribeInput struct {
	Prompt string
	Audio  CloudMedia
}

func (s *AICloudService) Transcribe(ctx context.Context, userID, orgID string, in CloudTranscribeInput) (string, error) {
	if err := s.gate(ctx, userID, orgID); err != nil {
		return "", err
	}
	if utf8.RuneCountInString(in.Prompt) > cloudPromptMaxRunes {
		return "", Invalid("prompt tối đa 4000 ký tự")
	}
	if !audioMIME(in.Audio.MIME) {
		return "", Invalid("audio phải là tệp âm thanh (audio/*, video/mp4 hoặc video/webm)")
	}
	audio, err := decodeMedia(in.Audio, cloudAudioMaxBytes, "audio tối đa 25 MiB")
	if err != nil {
		return "", err
	}
	if !s.gw.CloudAvailability().Transcribe {
		return "", ai.ErrCloudUnavailable
	}
	// The length is known only after the vendor answers; one minute is the
	// floor every call is charged.
	if err := s.charge(ctx, orgID, ai.TranscribeCharge(0)); err != nil {
		return "", err
	}
	res, err := s.gw.CloudTranscribe(ctx, s.call(userID, orgID), provider.TranscribeRequest{Prompt: strings.TrimSpace(in.Prompt), Audio: audio})
	if err != nil {
		return "", gatewayErr(err)
	}
	return res.Text, nil
}

// decodeMedia reads standard base64, with or without a data: URL prefix.
func decodeMedia(m CloudMedia, max int, tooLarge string) (provider.Part, error) {
	data := m.DataBase64
	if strings.HasPrefix(data, "data:") {
		if i := strings.Index(data, ";base64,"); i >= 0 {
			data = data[i+len(";base64,"):]
		}
	}
	if base64.StdEncoding.DecodedLen(len(data)) > max+3 {
		return provider.Part{}, Invalid(tooLarge)
	}
	b, err := base64.StdEncoding.DecodeString(data)
	if err != nil || len(b) == 0 {
		return provider.Part{}, Invalid("data_base64 không hợp lệ")
	}
	if len(b) > max {
		return provider.Part{}, Invalid(tooLarge)
	}
	return provider.Part{MIME: canonicalMIME(m.MIME), Data: b}, nil
}

// canonicalMIME is the bare lower-case type: parameters such as ";codecs=opus"
// (what MediaRecorder sends) are cut.
func canonicalMIME(m string) string {
	if i := strings.IndexByte(m, ';'); i >= 0 {
		m = m[:i]
	}
	return strings.ToLower(strings.TrimSpace(m))
}

// analyzeMIMEs is what media/analyze accepts. A type the main provider cannot
// read (video on Anthropic and OpenAI, PDF on OpenAI, audio on Anthropic) still
// gets as far as the gateway, which answers 422 media_unsupported too.
var analyzeMIMEs = map[string]bool{
	"image/png": true, "image/jpeg": true, "image/webp": true, "image/gif": true,
	"audio/mpeg": true, "audio/wav": true, "audio/mp4": true, "audio/webm": true,
	"video/mp4": true, "video/webm": true, "application/pdf": true,
}

func analyzeMIME(m string) (string, bool) {
	c := canonicalMIME(m)
	return c, analyzeMIMEs[c]
}

// mimeToken is the shape of a type that may be copied into a multipart part
// header: no control characters, no whitespace, bounded.
var mimeToken = regexp.MustCompile(`^[a-z0-9]+/[a-z0-9.+-]{1,100}$`)

func imageMIME(m string) bool {
	switch canonicalMIME(m) {
	case "image/png", "image/jpeg", "image/webp":
		return true
	}
	return false
}

func audioMIME(m string) bool {
	m = canonicalMIME(m)
	return mimeToken.MatchString(m) && (strings.HasPrefix(m, "audio/") || m == "video/mp4" || m == "video/webm")
}

// imageSize maps the client's hints onto the vendor's three sizes: an exact
// size wins, else the aspect ratio's orientation, else "auto".
func imageSize(size, aspect string) string {
	switch size {
	case "1024x1024", "1536x1024", "1024x1536", "auto":
		return size
	}
	switch aspect {
	case "1:1":
		return "1024x1024"
	case "16:9", "3:2", "4:3", "5:4", "21:9":
		return "1536x1024"
	case "9:16", "2:3", "3:4", "4:5":
		return "1024x1536"
	}
	return "auto"
}
