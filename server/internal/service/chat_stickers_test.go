package service

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestChatStickersTenorProxy(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v2/featured" {
			t.Fatalf("unexpected path: %s", r.URL.Path)
		}
		if r.URL.Query().Get("searchfilter") != "sticker" {
			t.Fatalf("expected sticker filter, got %q", r.URL.Query().Get("searchfilter"))
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{
			"results": [{
				"id": "st1",
				"content_description": "happy onion",
				"media_formats": {
					"webp_transparent": {"url": "https://media.tenor.com/sticker.webp"},
					"tinywebptransparent": {"url": "https://media.tenor.com/sticker-tiny.webp"}
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

	items, err := s.TrendingChatStickers(context.Background(), ua.ID, w.ID, 5)
	if err != nil {
		t.Fatalf("trending: %v", err)
	}
	if len(items) != 1 || items[0].URL != "https://media.tenor.com/sticker.webp" {
		t.Fatalf("unexpected items: %#v", items)
	}
}

func TestMapTenorSticker(t *testing.T) {
	item := mapTenorSticker("abc", "wave", map[string]tenorMediaFormat{
		"webp_transparent":    {URL: "https://example/sticker.webp"},
		"tinywebptransparent": {URL: "https://example/tiny.webp"},
	})
	if item.URL != "https://example/sticker.webp" || item.PreviewURL != "https://example/tiny.webp" {
		t.Fatalf("unexpected map: %#v", item)
	}
}

func TestChatStickersEmptyWithoutAPIKey(t *testing.T) {
	s, _, _, ua, _, w := chatFixture(t)
	items, err := s.TrendingChatStickers(context.Background(), ua.ID, w.ID, 10)
	if err != nil || len(items) == 0 {
		t.Fatalf("expected offline sticker fallback: err=%v items=%v", err, items)
	}
}
