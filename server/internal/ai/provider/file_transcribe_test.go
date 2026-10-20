package provider

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
)

// byteplusServer answers /submit and /query the way the BytePlus file ASR
// contract (parent spec §7.4) describes; status sets X-Api-Status-Code for
// /query, "" leaves the header out.
func byteplusServer(t *testing.T, status, body string, seen *[]*http.Request, bodies *[]map[string]any) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		*seen = append(*seen, r.Clone(context.Background()))
		var b map[string]any
		_ = json.NewDecoder(r.Body).Decode(&b)
		*bodies = append(*bodies, b)
		switch r.URL.Path {
		case "/submit":
			w.Header().Set("X-Api-Status-Code", "20000000")
			_, _ = w.Write([]byte(`{}`))
		case "/query":
			if status != "" {
				w.Header().Set("X-Api-Status-Code", status)
			}
			_, _ = w.Write([]byte(body))
		default:
			http.NotFound(w, r)
		}
	}))
}

func TestBytePlusSubmitSendsTheContract(t *testing.T) {
	var seen []*http.Request
	var bodies []map[string]any
	srv := byteplusServer(t, "", "", &seen, &bodies)
	defer srv.Close()
	bp := NewBytePlusFileTranscriber(srv.URL, "key-1", "res-1")
	id, err := bp.Submit(context.Background(), FileTranscribeRequest{
		RequestID: "tr1-2", AudioURL: "https://store.example/a.mp3?sig=x", MIME: "audio/mpeg", Language: "vi", Diarize: true,
	})
	if err != nil || id != "tr1-2" {
		t.Fatalf("submit = %q, %v; want the caller's request id", id, err)
	}
	r := seen[0]
	if r.Method != http.MethodPost || r.URL.Path != "/submit" {
		t.Fatalf("submit went to %s %s", r.Method, r.URL.Path)
	}
	for h, want := range map[string]string{
		"X-Api-Key": "key-1", "X-Api-Resource-Id": "res-1", "X-Api-Request-Id": id, "X-Api-Sequence": "-1",
	} {
		if got := r.Header.Get(h); got != want {
			t.Errorf("%s = %q, want %q", h, got, want)
		}
	}
	audio, _ := bodies[0]["audio"].(map[string]any)
	req, _ := bodies[0]["request"].(map[string]any)
	if audio["url"] != "https://store.example/a.mp3?sig=x" || audio["format"] != "mp3" || audio["language"] != "vi-VN" {
		t.Errorf("audio = %v", audio)
	}
	if req["model_name"] != "bigmodel" || req["enable_speaker_info"] != true || req["show_utterances"] != true || req["enable_itn"] != true || req["enable_punc"] != true {
		t.Errorf("request = %v", req)
	}
}

func TestBytePlusSubmitRefusesVideoAndAMissingStatus(t *testing.T) {
	bp := NewBytePlusFileTranscriber("http://127.0.0.1:1", "k", "r")
	if _, err := bp.Submit(context.Background(), FileTranscribeRequest{AudioURL: "u", MIME: "video/mp4"}); err == nil {
		t.Fatal("video/mp4 was submitted")
	}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { _, _ = w.Write([]byte(`{}`)) }))
	defer srv.Close()
	if _, err := NewBytePlusFileTranscriber(srv.URL, "k", "r").Submit(context.Background(), FileTranscribeRequest{AudioURL: "u", MIME: "audio/wav"}); err == nil {
		t.Fatal("a submit answer without X-Api-Status-Code counted as accepted")
	}
}

func TestBytePlusPoll(t *testing.T) {
	done := `{"audio_info":{"duration":61500},"result":{"text":"a b","utterances":[
		{"text":"Chào mọi người","start_time":0,"end_time":1700,"additions":{"speaker":"1"}},
		{"text":"Bắt đầu nhé","start_time":1800,"end_time":3000,"additions":{"speaker":"2"}},
		{"text":"  ","start_time":3000,"end_time":3100}]}}`
	cases := []struct {
		name, status, body string
		wantDone           bool
		wantErr            bool
		wantJobErr         string
	}{
		{name: "processing", status: "20000001", wantDone: false},
		{name: "queued", status: "20000002", wantDone: false},
		{name: "done", status: "20000000", body: done, wantDone: true},
		{name: "silent audio", status: "20000003", body: `{}`, wantDone: true},
		{name: "missing header", status: "", body: done, wantErr: true},
		{name: "vendor failure", status: "45000001", body: `{}`, wantErr: true, wantJobErr: "45000001"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			var seen []*http.Request
			var bodies []map[string]any
			srv := byteplusServer(t, tc.status, tc.body, &seen, &bodies)
			defer srv.Close()
			res, err := NewBytePlusFileTranscriber(srv.URL, "k", "r").Poll(context.Background(), "job-1")
			if seen[0].URL.Path != "/query" || seen[0].Header.Get("X-Api-Request-Id") != "job-1" {
				t.Fatalf("poll went to %s with id %q", seen[0].URL.Path, seen[0].Header.Get("X-Api-Request-Id"))
			}
			if tc.wantErr {
				if err == nil {
					t.Fatalf("no error, result %+v", res)
				}
				var je *FileJobError
				if tc.wantJobErr != "" && (!errors.As(err, &je) || je.Code != tc.wantJobErr) {
					t.Fatalf("err = %v, want job error %s", err, tc.wantJobErr)
				}
				if tc.wantJobErr == "" && errors.As(err, &je) {
					t.Fatalf("a missing header is a job failure: %v", err)
				}
				return
			}
			if err != nil || res.Done != tc.wantDone {
				t.Fatalf("poll = %+v, %v", res, err)
			}
			if res.Silent != (tc.name == "silent audio") {
				t.Fatalf("silent = %v", res.Silent)
			}
			if tc.name != "done" {
				return
			}
			if res.Seconds != 61.5 || len(res.Segments) != 2 {
				t.Fatalf("result = %+v", res)
			}
			s := res.Segments[1]
			if s.StartMs != 1800 || s.EndMs != 3000 || s.SpeakerLabel != "2" || s.Text != "Bắt đầu nhé" {
				t.Fatalf("segment = %+v", s)
			}
		})
	}
}
