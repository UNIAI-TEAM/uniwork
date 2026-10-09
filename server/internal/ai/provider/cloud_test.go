package provider

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func vendor(t *testing.T, check func(r *http.Request), reply string) *httptest.Server {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		check(r)
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, reply)
	}))
	t.Cleanup(srv.Close)
	return srv
}

func TestTavilyWebAndImage(t *testing.T) {
	var got map[string]any
	srv := vendor(t, func(r *http.Request) {
		if r.URL.Path != "/search" || r.Header.Get("Authorization") != "Bearer tv-key" {
			t.Errorf("request: %s %s", r.URL.Path, r.Header.Get("Authorization"))
		}
		_ = json.NewDecoder(r.Body).Decode(&got)
	}, `{"answer":"A","results":[{"title":"T","url":"https://a.example","content":"S"}],
		"images":["https://img.example/1.png",{"url":"https://img.example/2.png","description":"two"}]}`)
	tv := NewTavily(srv.URL, "tv-key")
	web, err := tv.Search(context.Background(), SearchRequest{Query: "q", Kind: "web", MaxResults: 3})
	if err != nil || web.Answer != "A" || len(web.Results) != 1 || web.Results[0].Snippet != "S" {
		t.Fatalf("web: %+v %v", web, err)
	}
	if got["max_results"] != float64(3) || got["include_images"] != false {
		t.Fatalf("web body: %v", got)
	}
	img, err := tv.Search(context.Background(), SearchRequest{Query: "q", Kind: "image", MaxResults: 2})
	if err != nil || len(img.Results) != 2 || img.Results[1].ImageURL != "https://img.example/2.png" || img.Results[1].Title != "two" {
		t.Fatalf("image: %+v %v", img, err)
	}
}

func TestBraveWebAndImage(t *testing.T) {
	srv := vendor(t, func(r *http.Request) {
		if r.Header.Get("X-Subscription-Token") != "bv-key" || r.URL.Query().Get("q") != "q" {
			t.Errorf("request: %s", r.URL)
		}
	}, `{"web":{"results":[{"title":"T","url":"https://a.example","description":"D","thumbnail":{"src":"https://t.example"}}]},
		"results":[{"title":"I","url":"https://page.example","thumbnail":{"src":"https://thumb.example"},"properties":{"url":"https://full.example"}}]}`)
	b := NewBrave(srv.URL, "bv-key")
	web, err := b.Search(context.Background(), SearchRequest{Query: "q", Kind: "web", MaxResults: 5})
	if err != nil || len(web.Results) != 1 || web.Results[0].Snippet != "D" {
		t.Fatalf("web: %+v %v", web, err)
	}
	img, err := b.Search(context.Background(), SearchRequest{Query: "q", Kind: "image", MaxResults: 5})
	if err != nil || len(img.Results) != 1 || img.Results[0].ImageURL != "https://full.example" || img.Results[0].ThumbnailURL != "https://thumb.example" {
		t.Fatalf("image: %+v %v", img, err)
	}
}

func TestOpenAIImagesGenerateAndEdit(t *testing.T) {
	png := base64.StdEncoding.EncodeToString(fakePNG)
	var paths []string
	srv := vendor(t, func(r *http.Request) {
		paths = append(paths, r.URL.Path)
		if r.Header.Get("Authorization") != "Bearer img-key" {
			t.Errorf("auth header missing")
		}
		if r.URL.Path == "/images/edits" {
			if err := r.ParseMultipartForm(1 << 20); err != nil || len(r.MultipartForm.File["image[]"]) != 2 || r.FormValue("prompt") != "p" {
				t.Errorf("edit form: %v", err)
			}
		}
	}, `{"data":[{"b64_json":"`+png+`"}]}`)
	o := NewOpenAIImages(srv.URL, "img-key", "")
	out, err := o.Generate(context.Background(), ImageRequest{Prompt: "p", Size: "1024x1024"})
	if err != nil || len(out.Images) != 1 || out.Images[0].MIME != "image/png" || out.Model != "gpt-image-1" {
		t.Fatalf("generate: %+v %v", out, err)
	}
	ref := Part{MIME: "image/png", Data: fakePNG}
	if _, err := o.Generate(context.Background(), ImageRequest{Prompt: "p", ReferenceImages: []Part{ref, ref}}); err != nil {
		t.Fatal(err)
	}
	if strings.Join(paths, ",") != "/images/generations,/images/edits" {
		t.Fatalf("paths: %v", paths)
	}
}

func TestOpenAITranscriberDuration(t *testing.T) {
	srv := vendor(t, func(r *http.Request) {
		if err := r.ParseMultipartForm(1 << 20); err != nil || r.FormValue("response_format") != "verbose_json" || len(r.MultipartForm.File["file"]) != 1 {
			t.Errorf("form: %v", err)
		}
	}, `{"text":"xin chào","duration":61.5}`)
	out, err := NewOpenAITranscriber(srv.URL, "k", "").Transcribe(context.Background(), TranscribeRequest{Audio: Part{MIME: "audio/mpeg", Data: []byte("abc")}})
	if err != nil || out.Text != "xin chào" || out.Seconds != 61.5 {
		t.Fatalf("%+v %v", out, err)
	}
}

// A vendor error carries status and body, never the key we sent.
func TestCloudVendorErrorHidesKey(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		http.Error(w, `{"error":"bad"}`, http.StatusUnauthorized)
	}))
	t.Cleanup(srv.Close)
	_, err := NewTavily(srv.URL, "secret-key-123").Search(context.Background(), SearchRequest{Query: "q", Kind: "web", MaxResults: 1})
	if err == nil || !strings.Contains(err.Error(), "401") || strings.Contains(err.Error(), "secret-key-123") {
		t.Fatalf("err: %v", err)
	}
}

func TestMediaPartsMapping(t *testing.T) {
	if _, err := openAIPart(Part{MIME: "video/mp4"}); err != ErrUnsupportedMedia {
		t.Fatalf("video on openai: %v", err)
	}
	c, err := openAIPart(Part{MIME: "image/png", Data: []byte{1}})
	if err != nil || c["type"] != "image_url" {
		t.Fatalf("image: %v %v", c, err)
	}
	if _, err := anthropicPart(Part{MIME: "audio/mpeg"}); err != ErrUnsupportedMedia {
		t.Fatalf("audio on anthropic: %v", err)
	}
	if _, err := anthropicPart(Part{MIME: "application/pdf", Data: []byte("%PDF")}); err != nil {
		t.Fatal(err)
	}
}
