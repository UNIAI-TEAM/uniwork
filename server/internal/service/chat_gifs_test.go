package service

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestChatGifsFallbackWithoutAPIKey(t *testing.T) {
	s, _, _, ua, _, w := chatFixture(t)
	ctx := context.Background()

	items, err := s.TrendingChatGifs(ctx, ua.ID, w.ID, 10)
	if err != nil || len(items) == 0 {
		t.Fatalf("trending fallback: err=%v items=%v", err, items)
	}

	found, err := s.SearchChatGifs(ctx, ua.ID, w.ID, "happy", 10)
	if err != nil || len(found) == 0 {
		t.Fatalf("search fallback: err=%v items=%v", err, found)
	}
}

func TestChatGifsTenorProxy(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v2/search" {
			t.Fatalf("unexpected path: %s", r.URL.Path)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{
			"results": [{
				"id": "gif1",
				"content_description": "happy dance",
				"media_formats": {
					"gif": {"url": "https://media.tenor.com/full.gif"},
					"tinygif": {"url": "https://media.tenor.com/tiny.gif"}
				}
			}]
		}`))
	}))
	defer srv.Close()

	prev := tenorAPIBase
	tenorAPIBase = srv.URL
	t.Cleanup(func() { tenorAPIBase = prev })

	s, _, _, ua, _, w := chatFixture(t)
	s.TenorAPIKey = "test-key"

	items, err := s.SearchChatGifs(context.Background(), ua.ID, w.ID, "happy", 5)
	if err != nil {
		t.Fatalf("search: %v", err)
	}
	if len(items) != 1 || items[0].URL != "https://media.tenor.com/full.gif" {
		t.Fatalf("unexpected items: %#v", items)
	}
}

func TestMapTenorGif(t *testing.T) {
	item := mapTenorGif("abc", "wave hello", map[string]tenorMediaFormat{
		"gif":     {URL: "https://example/full.gif"},
		"tinygif": {URL: "https://example/tiny.gif"},
	})
	if item.URL != "https://example/full.gif" || item.PreviewURL != "https://example/tiny.gif" {
		t.Fatalf("unexpected map: %#v", item)
	}
}
