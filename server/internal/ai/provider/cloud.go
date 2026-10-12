package provider

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// The UniWork cloud tools (GO-A7): web/image search, image generation and
// transcription, paid by UniWork with server-side vendor keys. Like the
// completion adapters they know nothing about tenants or credits; the gateway
// meters every call.

type SearchRequest struct {
	Query      string
	Kind       string // "web" | "image"
	MaxResults int
}

type SearchResult struct {
	Title        string
	URL          string
	Snippet      string
	ImageURL     string
	ThumbnailURL string
}

type SearchResponse struct {
	Results []SearchResult
	Answer  string
}

type Searcher interface {
	Name() string
	Search(ctx context.Context, req SearchRequest) (SearchResponse, error)
}

type ImageRequest struct {
	Prompt string
	// Size is the vendor size string ("1024x1024", "1536x1024", "auto").
	Size            string
	ReferenceImages []Part
}

type ImageResponse struct {
	Images []Part
	Model  string
}

type ImageGenerator interface {
	Name() string
	Model() string
	Generate(ctx context.Context, req ImageRequest) (ImageResponse, error)
}

type TranscribeRequest struct {
	Prompt string
	Audio  Part
}

type TranscribeResponse struct {
	Text string
	// Seconds is the audio duration the vendor reported; 0 when unknown.
	Seconds float64
	Model   string
}

type Transcriber interface {
	Name() string
	Model() string
	Transcribe(ctx context.Context, req TranscribeRequest) (TranscribeResponse, error)
}

// cloudTimeout bounds one tool call; image generation is the slow one.
const cloudTimeout = 3 * time.Minute

func cloudClient() *http.Client { return &http.Client{Timeout: cloudTimeout} }

// doVendor sends req and decodes a 2xx JSON body into out. The errors it
// returns reach the logs, so they carry the host, the path, the status and the
// vendor's error code only: never the query string (a search text), the
// vendor's message (it may echo the prompt or the key) or the request headers.
// key is the vendor key the request carries; it is scrubbed from what is kept.
func doVendor(client *http.Client, req *http.Request, key string, out any) error {
	where := req.Method + " " + req.URL.Host + req.URL.Path
	res, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("provider: %s: %s", where, transportReason(err))
	}
	defer res.Body.Close()
	data, err := io.ReadAll(io.LimitReader(res.Body, 64<<20))
	if err != nil {
		return fmt.Errorf("provider: %s: %s", where, transportReason(err))
	}
	if res.StatusCode < 200 || res.StatusCode > 299 {
		return fmt.Errorf("provider: %s → %d%s", where, res.StatusCode, vendorErrorCode(data, key))
	}
	if err := json.Unmarshal(data, out); err != nil {
		return fmt.Errorf("provider: %s: unreadable answer", where)
	}
	return nil
}

// vendorErrorCode extracts " (code)" from a vendor error body shaped like
// {"error":{"code"|"type":"..."}} or {"code":"..."}; anything else, and any
// value that is not a short token, yields "". The key is redacted from it.
func vendorErrorCode(body []byte, key string) string {
	var env struct {
		Code  json.RawMessage `json:"code"`
		Error json.RawMessage `json:"error"`
	}
	if json.Unmarshal(body, &env) != nil {
		return ""
	}
	pick := func(raw json.RawMessage) string {
		var s string
		if json.Unmarshal(raw, &s) == nil {
			return s
		}
		return ""
	}
	code := pick(env.Code)
	if code == "" {
		var inner struct {
			Code json.RawMessage `json:"code"`
			Type json.RawMessage `json:"type"`
		}
		if json.Unmarshal(env.Error, &inner) == nil {
			if code = pick(inner.Code); code == "" {
				code = pick(inner.Type)
			}
		}
	}
	if len(code) == 0 || len(code) > 64 {
		return ""
	}
	for _, r := range code {
		if !(r >= 'a' && r <= 'z' || r >= 'A' && r <= 'Z' || r >= '0' && r <= '9' || r == '_' || r == '.' || r == '-') {
			return ""
		}
	}
	if key != "" && strings.Contains(code, key) {
		code = "[redacted]"
	}
	return " (" + code + ")"
}

func trimBase(base, def string) string {
	if base == "" {
		base = def
	}
	return strings.TrimSuffix(base, "/")
}

// ---- Tavily ----

type Tavily struct {
	baseURL, apiKey string
	http            *http.Client
}

func NewTavily(baseURL, apiKey string) *Tavily {
	return &Tavily{baseURL: trimBase(baseURL, "https://api.tavily.com"), apiKey: apiKey, http: cloudClient()}
}

func (t *Tavily) Name() string { return "tavily" }

func (t *Tavily) Search(ctx context.Context, sr SearchRequest) (SearchResponse, error) {
	image := sr.Kind == "image"
	body, _ := json.Marshal(map[string]any{
		"query": sr.Query, "max_results": sr.MaxResults, "include_answer": !image,
		"include_images": image, "include_image_descriptions": image,
	})
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, t.baseURL+"/search", bytes.NewReader(body))
	if err != nil {
		return SearchResponse{}, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+t.apiKey)
	var out struct {
		Answer  string `json:"answer"`
		Results []struct {
			Title   string `json:"title"`
			URL     string `json:"url"`
			Content string `json:"content"`
		} `json:"results"`
		// Images are strings, or {url, description} with descriptions on.
		Images []json.RawMessage `json:"images"`
	}
	if err := doVendor(t.http, req, t.apiKey, &out); err != nil {
		return SearchResponse{}, err
	}
	resp := SearchResponse{Answer: out.Answer, Results: []SearchResult{}}
	if !image {
		for _, r := range out.Results {
			resp.Results = append(resp.Results, SearchResult{Title: r.Title, URL: r.URL, Snippet: r.Content})
		}
		return resp, nil
	}
	for _, raw := range out.Images {
		var u string
		var obj struct {
			URL         string `json:"url"`
			Description string `json:"description"`
		}
		if json.Unmarshal(raw, &u) != nil {
			if json.Unmarshal(raw, &obj) != nil {
				continue
			}
			u = obj.URL
		}
		if u == "" {
			continue
		}
		resp.Results = append(resp.Results, SearchResult{Title: obj.Description, URL: u, Snippet: obj.Description, ImageURL: u, ThumbnailURL: u})
	}
	return resp, nil
}

// ---- Brave ----

type Brave struct {
	baseURL, apiKey string
	http            *http.Client
}

func NewBrave(baseURL, apiKey string) *Brave {
	return &Brave{baseURL: trimBase(baseURL, "https://api.search.brave.com/res/v1"), apiKey: apiKey, http: cloudClient()}
}

func (b *Brave) Name() string { return "brave" }

func (b *Brave) Search(ctx context.Context, sr SearchRequest) (SearchResponse, error) {
	path := "/web/search"
	if sr.Kind == "image" {
		path = "/images/search"
	}
	params := url.Values{"q": {sr.Query}, "count": {fmt.Sprint(sr.MaxResults)}}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, b.baseURL+path+"?"+params.Encode(), nil)
	if err != nil {
		return SearchResponse{}, err
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("X-Subscription-Token", b.apiKey)
	type thumb struct {
		Src string `json:"src"`
	}
	var out struct {
		Web struct {
			Results []struct {
				Title       string `json:"title"`
				URL         string `json:"url"`
				Description string `json:"description"`
				Thumbnail   thumb  `json:"thumbnail"`
			} `json:"results"`
		} `json:"web"`
		Results []struct {
			Title      string `json:"title"`
			URL        string `json:"url"`
			Thumbnail  thumb  `json:"thumbnail"`
			Properties struct {
				URL string `json:"url"`
			} `json:"properties"`
		} `json:"results"`
	}
	if err := doVendor(b.http, req, b.apiKey, &out); err != nil {
		return SearchResponse{}, err
	}
	resp := SearchResponse{Results: []SearchResult{}}
	if sr.Kind == "image" {
		for _, r := range out.Results {
			resp.Results = append(resp.Results, SearchResult{Title: r.Title, URL: r.URL, ImageURL: r.Properties.URL, ThumbnailURL: r.Thumbnail.Src})
		}
		return resp, nil
	}
	for _, r := range out.Web.Results {
		resp.Results = append(resp.Results, SearchResult{Title: r.Title, URL: r.URL, Snippet: r.Description, ThumbnailURL: r.Thumbnail.Src})
	}
	return resp, nil
}

// ---- OpenAI images and transcription ----

type OpenAIImages struct {
	baseURL, apiKey, model string
	http                   *http.Client
}

func NewOpenAIImages(baseURL, apiKey, model string) *OpenAIImages {
	if model == "" {
		model = "gpt-image-1"
	}
	return &OpenAIImages{baseURL: trimBase(baseURL, "https://api.openai.com/v1"), apiKey: apiKey, model: model, http: cloudClient()}
}

func (o *OpenAIImages) Name() string  { return "openai" }
func (o *OpenAIImages) Model() string { return o.model }

func (o *OpenAIImages) Generate(ctx context.Context, ir ImageRequest) (ImageResponse, error) {
	size := ir.Size
	if size == "" {
		size = "auto"
	}
	if size == "auto" && strings.HasPrefix(o.model, "dall-e") {
		size = "1024x1024" // dall-e refuses "auto"
	}
	var req *http.Request
	var err error
	if len(ir.ReferenceImages) == 0 {
		body := map[string]any{"model": o.model, "prompt": ir.Prompt, "n": 1, "size": size}
		if strings.HasPrefix(o.model, "dall-e") {
			body["response_format"] = "b64_json"
		}
		b, _ := json.Marshal(body)
		req, err = http.NewRequestWithContext(ctx, http.MethodPost, o.baseURL+"/images/generations", bytes.NewReader(b))
		if err != nil {
			return ImageResponse{}, err
		}
		req.Header.Set("Content-Type", "application/json")
	} else {
		fields := map[string]string{"model": o.model, "prompt": ir.Prompt, "n": "1", "size": size}
		files := make([]multipartFile, 0, len(ir.ReferenceImages))
		for i, p := range ir.ReferenceImages {
			files = append(files, multipartFile{field: "image[]", name: fmt.Sprintf("reference-%d%s", i+1, mimeExt(p.MIME)), part: p})
		}
		req, err = multipartRequest(ctx, o.baseURL+"/images/edits", fields, files)
		if err != nil {
			return ImageResponse{}, err
		}
	}
	req.Header.Set("Authorization", "Bearer "+o.apiKey)
	var out struct {
		Data []struct {
			B64JSON string `json:"b64_json"`
		} `json:"data"`
		OutputFormat string `json:"output_format"`
	}
	if err := doVendor(o.http, req, o.apiKey, &out); err != nil {
		return ImageResponse{}, err
	}
	mimeType := "image/png"
	switch out.OutputFormat {
	case "jpeg":
		mimeType = "image/jpeg"
	case "webp":
		mimeType = "image/webp"
	}
	resp := ImageResponse{Model: o.model}
	for _, d := range out.Data {
		data, err := base64.StdEncoding.DecodeString(d.B64JSON)
		if err != nil || len(data) == 0 {
			continue
		}
		resp.Images = append(resp.Images, Part{MIME: mimeType, Data: data})
	}
	if len(resp.Images) == 0 {
		return ImageResponse{}, fmt.Errorf("openai images: no image in response")
	}
	return resp, nil
}

type OpenAITranscriber struct {
	baseURL, apiKey, model string
	http                   *http.Client
}

func NewOpenAITranscriber(baseURL, apiKey, model string) *OpenAITranscriber {
	if model == "" {
		model = "whisper-1"
	}
	return &OpenAITranscriber{baseURL: trimBase(baseURL, "https://api.openai.com/v1"), apiKey: apiKey, model: model, http: cloudClient()}
}

func (o *OpenAITranscriber) Name() string  { return "openai" }
func (o *OpenAITranscriber) Model() string { return o.model }

func (o *OpenAITranscriber) Transcribe(ctx context.Context, tr TranscribeRequest) (TranscribeResponse, error) {
	format := "json"
	if o.model == "whisper-1" {
		format = "verbose_json" // carries the duration the credits are charged on
	}
	fields := map[string]string{"model": o.model, "response_format": format}
	if tr.Prompt != "" {
		fields["prompt"] = tr.Prompt
	}
	req, err := multipartRequest(ctx, o.baseURL+"/audio/transcriptions", fields,
		[]multipartFile{{field: "file", name: "audio" + mimeExt(tr.Audio.MIME), part: tr.Audio}})
	if err != nil {
		return TranscribeResponse{}, err
	}
	req.Header.Set("Authorization", "Bearer "+o.apiKey)
	var out struct {
		Text     string  `json:"text"`
		Duration float64 `json:"duration"`
		Usage    struct {
			Type    string  `json:"type"`
			Seconds float64 `json:"seconds"`
		} `json:"usage"`
	}
	if err := doVendor(o.http, req, o.apiKey, &out); err != nil {
		return TranscribeResponse{}, err
	}
	secs := out.Duration
	if secs == 0 && out.Usage.Type == "duration" {
		secs = out.Usage.Seconds
	}
	return TranscribeResponse{Text: out.Text, Seconds: secs, Model: o.model}, nil
}

type multipartFile struct {
	field, name string
	part        Part
}

func multipartRequest(ctx context.Context, url string, fields map[string]string, files []multipartFile) (*http.Request, error) {
	var buf bytes.Buffer
	mw := multipart.NewWriter(&buf)
	for k, v := range fields {
		if err := mw.WriteField(k, v); err != nil {
			return nil, err
		}
	}
	for _, f := range files {
		h := make(map[string][]string)
		h["Content-Disposition"] = []string{fmt.Sprintf(`form-data; name=%q; filename=%q`, f.field, f.name)}
		h["Content-Type"] = []string{f.part.MIME}
		w, err := mw.CreatePart(h)
		if err != nil {
			return nil, err
		}
		if _, err := w.Write(f.part.Data); err != nil {
			return nil, err
		}
	}
	if err := mw.Close(); err != nil {
		return nil, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, &buf)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", mw.FormDataContentType())
	return req, nil
}

// mimeExt names the upload so vendors that sniff by extension accept it.
func mimeExt(m string) string {
	switch m {
	case "image/png":
		return ".png"
	case "image/jpeg":
		return ".jpg"
	case "image/webp":
		return ".webp"
	case "image/gif":
		return ".gif"
	case "audio/mpeg", "audio/mp3":
		return ".mp3"
	case "audio/wav", "audio/x-wav", "audio/wave":
		return ".wav"
	case "audio/mp4", "audio/m4a", "audio/x-m4a":
		return ".m4a"
	case "audio/webm", "video/webm":
		return ".webm"
	case "audio/ogg":
		return ".ogg"
	case "audio/flac":
		return ".flac"
	case "video/mp4":
		return ".mp4"
	}
	return ""
}

// ---- Fakes: AI_CLOUD_*_PROVIDER=fake for development, tests and E2E ----

// FakeSearch answers every query with MaxResults deterministic results.
type FakeSearch struct {
	Err   error
	Calls int
}

func (f *FakeSearch) Name() string { return "fake" }

func (f *FakeSearch) Search(_ context.Context, sr SearchRequest) (SearchResponse, error) {
	f.Calls++
	if f.Err != nil {
		return SearchResponse{}, f.Err
	}
	resp := SearchResponse{Results: []SearchResult{}}
	for i := 1; i <= sr.MaxResults; i++ {
		r := SearchResult{
			Title: fmt.Sprintf("%s — kết quả %d", sr.Query, i), URL: fmt.Sprintf("https://example.com/search/%d", i),
			Snippet: "Kết quả thử nghiệm cho " + sr.Query,
		}
		if sr.Kind == "image" {
			r.ImageURL = fmt.Sprintf("https://example.com/images/%d.png", i)
			r.ThumbnailURL = fmt.Sprintf("https://example.com/images/%d-thumb.png", i)
		}
		resp.Results = append(resp.Results, r)
	}
	if sr.Kind != "image" {
		resp.Answer = "Câu trả lời thử nghiệm cho " + sr.Query
	}
	return resp, nil
}

// fakePNG is a 1x1 transparent PNG.
var fakePNG, _ = base64.StdEncoding.DecodeString("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==")

// FakeImages returns one 1x1 PNG per call.
type FakeImages struct {
	Err   error
	Calls int
	Last  ImageRequest
}

func (f *FakeImages) Name() string  { return "fake" }
func (f *FakeImages) Model() string { return "fake-image" }

func (f *FakeImages) Generate(_ context.Context, ir ImageRequest) (ImageResponse, error) {
	f.Calls++
	f.Last = ir
	if f.Err != nil {
		return ImageResponse{}, f.Err
	}
	return ImageResponse{Images: []Part{{MIME: "image/png", Data: fakePNG}}, Model: "fake-image"}, nil
}

// FakeTranscriber reports one second of audio per 16 KiB.
type FakeTranscriber struct {
	Err   error
	Calls int
}

func (f *FakeTranscriber) Name() string  { return "fake" }
func (f *FakeTranscriber) Model() string { return "fake-transcribe" }

func (f *FakeTranscriber) Transcribe(_ context.Context, tr TranscribeRequest) (TranscribeResponse, error) {
	f.Calls++
	if f.Err != nil {
		return TranscribeResponse{}, f.Err
	}
	return TranscribeResponse{Text: "Bản ghi thử nghiệm.", Seconds: float64(len(tr.Audio.Data)) / 16384, Model: "fake-transcribe"}, nil
}
