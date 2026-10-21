package provider

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
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
		AudioURL: "https://store.example/a.mp4?sig=x", Diarize: true,
	})
	if err != nil || id != "5551722-f677-48a7-9a4f" {
		t.Fatalf("submit = %q, %v; want the vendor's transcript id", id, err)
	}
	r := seen[0]
	if r.Method != http.MethodPost || r.URL.Path != "/v2/transcript" || r.Header.Get("Authorization") != "key-1" {
		t.Fatalf("submit went to %s %s with key %q", r.Method, r.URL.Path, r.Header.Get("Authorization"))
	}
	// Exactly these fields: universal-2 takes over where 3.5 Pro cannot, and
	// it allows two codes with one of them en; no language_code or
	// language_detection beside language_codes.
	got, _ := json.Marshal(bodies[0])
	want := `{"audio_url":"https://store.example/a.mp4?sig=x","language_codes":["vi","en"],"speaker_labels":true,"speech_models":["universal-3-5-pro","universal-2"]}`
	if string(got) != want {
		t.Fatalf("body = %s\nwant   %s", got, want)
	}
	if a.Name() != "assemblyai" || a.Model() != "universal-3-5-pro" {
		t.Fatalf("name/model = %s/%s", a.Name(), a.Model())
	}
}

func TestAssemblyAISubmitRefusals(t *testing.T) {
	for _, tc := range []struct {
		name      string
		code      int
		body      string
		permanent bool
		retryIn   time.Duration
	}{
		{"bad request", 400, `{"error":"language not supported"}`, true, 0},
		{"unauthorized", 401, `{"error":"Invalid API key"}`, true, 0},
		{"forbidden", 403, `{"error":"account disabled"}`, true, 0},
		{"unprocessable", 422, `{"error":"bad audio_url"}`, true, 0},
		{"rate limited", 429, `{"error":"slow down"}`, false, 30 * time.Second},
		{"vendor down", 503, ``, false, 0},
		{"malformed", 200, `{"id":`, false, 0},
		{"no id", 200, `{"status":"queued"}`, false, 0},
		{"already failed", 200, `{"id":"x","status":"error","error":"Transcoding failed"}`, true, 0},
	} {
		t.Run(tc.name, func(t *testing.T) {
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if tc.code == 429 {
					w.Header().Set("Retry-After", "30")
				}
				w.WriteHeader(tc.code)
				_, _ = w.Write([]byte(tc.body))
			}))
			defer srv.Close()
			_, err := NewAssemblyAIFileTranscriber(srv.URL, "secret-key").Submit(context.Background(),
				FileTranscribeRequest{AudioURL: "https://store.example/a.mp3?sig=private", Diarize: true})
			if err == nil {
				t.Fatal("refused submit counted as accepted")
			}
			if strings.Contains(err.Error(), "secret-key") || strings.Contains(err.Error(), "sig=private") {
				t.Fatalf("error leaks the key or the URL: %v", err)
			}
			var je *FileJobError
			if got := errors.As(err, &je) && je.Permanent; got != tc.permanent {
				t.Fatalf("permanent = %v, want %v (%v)", got, tc.permanent, err)
			}
			var ra *RetryAfterError
			if got := time.Duration(0); errors.As(err, &ra) {
				if got = ra.After; got != tc.retryIn {
					t.Fatalf("retry after %v, want %v", got, tc.retryIn)
				}
			} else if tc.retryIn != 0 {
				t.Fatalf("429 without a retry pause: %v", err)
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
		name          string
		code          int
		body          string
		wantDone      bool
		wantErr       bool
		wantJobErr    bool
		wantPermanent bool
		wantReason    string
		wantModel     string
	}{
		{name: "queued", code: 200, body: `{"id":"j","status":"queued"}`},
		{name: "processing", code: 200, body: `{"id":"j","status":"processing"}`},
		{name: "completed", code: 200, body: done, wantDone: true},
		{name: "silent audio", code: 200, body: `{"id":"j","status":"completed","audio_duration":42,"text":"","utterances":[],"words":[]}`, wantDone: true},
		{name: "no utterances", code: 200, body: `{"id":"j","status":"completed","audio_duration":5,"text":"Xin chào.","utterances":null,
			"words":[{"text":"Xin","start":120,"end":400},{"text":"chào.","start":420,"end":900}]}`, wantDone: true},
		{name: "fallback model", code: 200, body: `{"id":"j","status":"completed","speech_model_used":"universal-2","audio_duration":3,"text":"Chào.","utterances":[{"speaker":"A","start":0,"end":900,"text":"Chào."}]}`, wantDone: true, wantModel: "universal-2"},
		{name: "vendor could not download", code: 200, body: `{"id":"j","status":"error","error":"Download error, unable to download https://x.example/a.mp3?sig=private. Please make sure the file exists"}`,
			wantErr: true, wantJobErr: true, wantReason: "Download error, unable to download <url> Please make sure the file exists"},
		{name: "vendor failed the job", code: 200, body: `{"id":"j","status":"error","error":"Transcoding failed for http://y/b.mp4"}`,
			wantErr: true, wantJobErr: true, wantPermanent: true, wantReason: "Transcoding failed for <url>"},
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
				if je != nil && (je.Permanent != tc.wantPermanent || je.Reason != tc.wantReason) {
					t.Fatalf("job error = %+v, want permanent %v reason %q", je, tc.wantPermanent, tc.wantReason)
				}
				if strings.Contains(err.Error(), "sig=private") {
					t.Fatalf("error carries the vendor's message with the URL: %v", err)
				}
				return
			}
			if tc.wantModel == "" {
				tc.wantModel = "universal-3-5-pro"
			}
			if err != nil || res.Done != tc.wantDone || res.Model != tc.wantModel {
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

// After the worker has the transcript, the vendor's copy is deleted (§7.5).
func TestAssemblyAIDelete(t *testing.T) {
	for _, code := range []int{200, 500} {
		var got *http.Request
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			got = r.Clone(context.Background())
			w.WriteHeader(code)
			_, _ = w.Write([]byte(`{"id":"job-1","status":"completed","text":"Deleted by user."}`))
		}))
		err := NewAssemblyAIFileTranscriber(srv.URL, "k").Delete(context.Background(), "job-1")
		srv.Close()
		if got.Method != http.MethodDelete || got.URL.Path != "/v2/transcript/job-1" || got.Header.Get("Authorization") != "k" {
			t.Fatalf("delete went to %s %s", got.Method, got.URL.Path)
		}
		if (err != nil) != (code != 200) {
			t.Fatalf("%d: err = %v", code, err)
		}
	}
}
