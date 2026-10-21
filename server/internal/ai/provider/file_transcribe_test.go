package provider

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// assemblyServer answers POST /v2/transcript and GET /v2/transcript/{id} the
// way AssemblyAI's pre-recorded API documents them (parent spec §7.4): code
// and body are what the GET returns.
func assemblyServer(t *testing.T, code int, body string, seen *[]*http.Request, bodies *[]map[string]any) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		*seen = append(*seen, r.Clone(context.Background()))
		var b map[string]any
		_ = json.NewDecoder(r.Body).Decode(&b)
		*bodies = append(*bodies, b)
		switch {
		case r.Method == http.MethodPost && r.URL.Path == "/v2/transcript":
			_, _ = w.Write([]byte(`{"id":"5551722-f677-48a7-9a4f","status":"queued"}`))
		case r.Method == http.MethodGet && strings.HasPrefix(r.URL.Path, "/v2/transcript/"):
			w.WriteHeader(code)
			_, _ = w.Write([]byte(body))
		default:
			http.NotFound(w, r)
		}
	}))
}

func TestAssemblyAISubmitSendsTheContract(t *testing.T) {
	var seen []*http.Request
	var bodies []map[string]any
	srv := assemblyServer(t, 200, "", &seen, &bodies)
	defer srv.Close()
	a := NewAssemblyAIFileTranscriber(srv.URL+"/", "key-1")
	id, err := a.Submit(context.Background(), FileTranscribeRequest{
		AudioURL: "https://store.example/a.mp4?sig=x", Language: "vi", Diarize: true,
	})
	if err != nil || id != "5551722-f677-48a7-9a4f" {
		t.Fatalf("submit = %q, %v; want the vendor's transcript id", id, err)
	}
	r := seen[0]
	if r.Method != http.MethodPost || r.URL.Path != "/v2/transcript" || r.Header.Get("Authorization") != "key-1" {
		t.Fatalf("submit went to %s %s with key %q", r.Method, r.URL.Path, r.Header.Get("Authorization"))
	}
	b := bodies[0]
	models, _ := b["speech_models"].([]any)
	langs, _ := b["language_codes"].([]any)
	if b["audio_url"] != "https://store.example/a.mp4?sig=x" || b["speaker_labels"] != true ||
		len(models) != 1 || models[0] != "universal-3-5-pro" || len(langs) != 2 || langs[0] != "vi" || langs[1] != "en" {
		t.Fatalf("body = %v", b)
	}
	if _, ok := b["language_code"]; ok {
		t.Fatalf("language_code is exclusive with language_codes: %v", b)
	}
	if a.Name() != "assemblyai" || a.Model() != "universal-3-5-pro" {
		t.Fatalf("name/model = %s/%s", a.Name(), a.Model())
	}
}

func TestAssemblyAISubmitRefusals(t *testing.T) {
	for _, tc := range []struct {
		name string
		code int
		body string
	}{
		{"bad request", 400, `{"error":"language not supported"}`},
		{"unauthorized", 401, `{"error":"Invalid API key"}`},
		{"vendor down", 503, ``},
		{"malformed", 200, `{"id":`},
		{"no id", 200, `{"status":"queued"}`},
		{"already failed", 200, `{"id":"x","status":"error","error":"Download error"}`},
	} {
		t.Run(tc.name, func(t *testing.T) {
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.WriteHeader(tc.code)
				_, _ = w.Write([]byte(tc.body))
			}))
			defer srv.Close()
			_, err := NewAssemblyAIFileTranscriber(srv.URL, "secret-key").Submit(context.Background(),
				FileTranscribeRequest{AudioURL: "https://store.example/a.mp3?sig=private", Language: "en", Diarize: true})
			if err == nil {
				t.Fatal("refused submit counted as accepted")
			}
			if strings.Contains(err.Error(), "secret-key") || strings.Contains(err.Error(), "sig=private") {
				t.Fatalf("error leaks the key or the URL: %v", err)
			}
		})
	}
}

func TestAssemblyAIPoll(t *testing.T) {
	done := `{"id":"j","status":"completed","audio_duration":3725,"language_code":"vi","text":"…",
		"utterances":[
		{"speaker":"A","start":0,"end":1700,"confidence":0.93,"text":"Chào mọi người, bắt đầu họp nhé.","words":[]},
		{"speaker":"B","start":1800,"end":3000,"confidence":0.9,"text":"OK, em báo cáo deadline sprint.","words":[]},
		{"speaker":"A","start":3000,"end":3100,"confidence":0.5,"text":"  ","words":[]}]}`
	cases := []struct {
		name       string
		code       int
		body       string
		wantDone   bool
		wantErr    bool
		wantJobErr bool
	}{
		{name: "queued", code: 200, body: `{"id":"j","status":"queued"}`},
		{name: "processing", code: 200, body: `{"id":"j","status":"processing"}`},
		{name: "completed", code: 200, body: done, wantDone: true},
		{name: "silent audio", code: 200, body: `{"id":"j","status":"completed","audio_duration":42,"text":"","utterances":[],"words":[]}`, wantDone: true},
		{name: "no utterances", code: 200, body: `{"id":"j","status":"completed","audio_duration":5,"text":"Xin chào.","utterances":null,
			"words":[{"text":"Xin","start":120,"end":400},{"text":"chào.","start":420,"end":900}]}`, wantDone: true},
		{name: "vendor failed the job", code: 200, body: `{"id":"j","status":"error","error":"Download error, unable to download https://x?sig=private"}`, wantErr: true, wantJobErr: true},
		{name: "unknown transcript", code: 404, body: `{"error":"Transcript not found"}`, wantErr: true, wantJobErr: true},
		{name: "rate limited", code: 429, body: `{"error":"slow down"}`, wantErr: true},
		{name: "vendor down", code: 500, body: ``, wantErr: true},
		{name: "malformed", code: 200, body: `{"status":`, wantErr: true},
		{name: "unknown status", code: 200, body: `{"id":"j","status":"paused"}`, wantErr: true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			var seen []*http.Request
			var bodies []map[string]any
			srv := assemblyServer(t, tc.code, tc.body, &seen, &bodies)
			defer srv.Close()
			res, err := NewAssemblyAIFileTranscriber(srv.URL, "k").Poll(context.Background(), "job-1")
			if seen[0].Method != http.MethodGet || seen[0].URL.Path != "/v2/transcript/job-1" || seen[0].Header.Get("Authorization") != "k" {
				t.Fatalf("poll went to %s %s", seen[0].Method, seen[0].URL.Path)
			}
			var je *FileJobError
			if tc.wantErr {
				if err == nil {
					t.Fatalf("no error, result %+v", res)
				}
				if errors.As(err, &je) != tc.wantJobErr {
					t.Fatalf("err = %v, want job error %v", err, tc.wantJobErr)
				}
				if strings.Contains(err.Error(), "sig=private") {
					t.Fatalf("error carries the vendor's message with the URL: %v", err)
				}
				return
			}
			if err != nil || res.Done != tc.wantDone || res.Model != "universal-3-5-pro" {
				t.Fatalf("poll = %+v, %v", res, err)
			}
			if res.Silent != (tc.name == "silent audio") {
				t.Fatalf("silent = %v", res.Silent)
			}
			switch tc.name {
			case "completed":
				if res.Seconds != 3725 || len(res.Segments) != 2 {
					t.Fatalf("result = %+v", res)
				}
				s := res.Segments[1]
				if s.StartMs != 1800 || s.EndMs != 3000 || s.SpeakerLabel != "B" || s.Text != "OK, em báo cáo deadline sprint." {
					t.Fatalf("segment = %+v", s)
				}
			case "no utterances":
				if len(res.Segments) != 1 || res.Segments[0] != (FileSegment{StartMs: 120, EndMs: 900, Text: "Xin chào."}) {
					t.Fatalf("segments = %+v", res.Segments)
				}
			}
		})
	}
}
