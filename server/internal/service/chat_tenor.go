package service

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

type tenorMapper func(id, description string, formats map[string]tenorMediaFormat) ChatGifItem

type tenorRequest struct {
	endpoint     string
	params       url.Values
	mediaFilter  string
	searchFilter string
	mapItem      tenorMapper
	fallback     []ChatGifItem
}

func (s *ChatService) fetchTenor(ctx context.Context, req tenorRequest) ([]ChatGifItem, error) {
	apiKey := strings.TrimSpace(s.TenorAPIKey)
	if apiKey == "" {
		if len(req.fallback) == 0 {
			return []ChatGifItem{}, nil
		}
		return append([]ChatGifItem(nil), req.fallback...), nil
	}

	params := url.Values{}
	for key, values := range req.params {
		for _, value := range values {
			params.Add(key, value)
		}
	}
	params.Set("key", apiKey)
	params.Set("client_key", tenorClientKey)
	params.Set("locale", tenorLocale)
	params.Set("media_filter", req.mediaFilter)
	if req.searchFilter != "" {
		params.Set("searchfilter", req.searchFilter)
	}

	path := "/v2/" + req.endpoint
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodGet, tenorAPIBase+path+"?"+params.Encode(), nil)
	if err != nil {
		return nil, err
	}

	client := &http.Client{Timeout: 8 * time.Second}
	resp, err := client.Do(httpReq)
	if err != nil {
		return appendFallback(req.fallback), nil
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		_, _ = io.Copy(io.Discard, resp.Body)
		return appendFallback(req.fallback), nil
	}

	var payload tenorGifResponse
	if err := json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(&payload); err != nil {
		return appendFallback(req.fallback), nil
	}

	out := make([]ChatGifItem, 0, len(payload.Results))
	for _, row := range payload.Results {
		item := req.mapItem(row.ID, row.ContentDescription, row.MediaFormats)
		if item.URL == "" {
			continue
		}
		out = append(out, item)
	}
	if len(out) == 0 {
		return appendFallback(req.fallback), nil
	}
	return out, nil
}

func appendFallback(fallback []ChatGifItem) []ChatGifItem {
	if len(fallback) == 0 {
		return []ChatGifItem{}
	}
	return append([]ChatGifItem(nil), fallback...)
}

func pickTenorFormat(formats map[string]tenorMediaFormat, keys ...string) string {
	for _, key := range keys {
		if url := strings.TrimSpace(formats[key].URL); url != "" {
			return url
		}
	}
	return ""
}
