package handler

import (
	"encoding/base64"
	"net/http"
	"time"

	"github.com/unicomhub/uniwork/server/internal/ai"
	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdi"
	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdo"
	"github.com/unicomhub/uniwork/server/internal/service"
)

// Body caps of the cloud routes: base64 inflates bytes by 4/3, so a route
// whose files may total 25 MiB decoded takes a 36 MiB body, and the images
// route (4 reference images of 8 MiB each = 32 MiB decoded, ~42.7 MiB of
// base64, plus a 4000-character prompt and the JSON around them) takes 44 MiB.
const (
	maxCloudImageBody = 44 << 20
	maxCloudMediaBody = 36 << 20
)

// aiCloud answers 503 cloud_unavailable when the server has no cloud service.
func (h *aiHandlers) aiCloud(w http.ResponseWriter) *service.AICloudService {
	if h.AICloud == nil {
		h.mapServiceError(w, ai.ErrCloudUnavailable)
	}
	return h.AICloud
}

func cloudMedia(in sdi.AiCloudMediaSDI) service.CloudMedia {
	return service.CloudMedia{MIME: in.Mime, DataBase64: in.DataBase64}
}

func (h *aiHandlers) aiCloudStatus(w http.ResponseWriter, r *http.Request) {
	userID, orgID, ok := h.resolve(w, r)
	if !ok {
		return
	}
	svc := h.aiCloud(w)
	if svc == nil {
		return
	}
	st, err := svc.Status(r.Context(), userID, orgID)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	out := sdo.AiCloudStatusSDO{
		Enabled: st.Enabled, Reason: st.Reason,
		Tools: sdo.AiCloudToolsDTO{
			WebSearch: st.Tools.WebSearch, ImageSearch: st.Tools.ImageSearch, ImageGenerate: st.Tools.ImageGenerate,
			MediaAnalyze: st.Tools.MediaAnalyze, Transcribe: st.Tools.Transcribe,
		},
		Credits: sdo.AiCloudCreditsDTO{Unit: service.FeatureAITokens, Used: st.Credits.Used, Limit: st.Credits.Limit, Remaining: st.Credits.Remaining},
	}
	if st.Credits.PeriodEnd != nil {
		end := st.Credits.PeriodEnd.Format(time.RFC3339)
		out.Credits.PeriodEnd = &end
	}
	respondJSON(w, http.StatusOK, out)
}

func (h *aiHandlers) aiCloudSearch(w http.ResponseWriter, r *http.Request) {
	userID, orgID, ok := h.resolve(w, r)
	if !ok {
		return
	}
	svc := h.aiCloud(w)
	if svc == nil {
		return
	}
	var in sdi.AiCloudSearchSDI
	if !decode(w, r, &in, maxJSONBody) {
		return
	}
	res, err := svc.Search(r.Context(), userID, orgID, service.CloudSearchInput{
		Query: in.Query, Kind: in.Kind, MaxResults: in.MaxResults,
	})
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	out := sdo.AiCloudSearchSDO{Answer: res.Answer, Results: make([]sdo.AiCloudSearchResultDTO, 0, len(res.Results))}
	for _, x := range res.Results {
		out.Results = append(out.Results, sdo.AiCloudSearchResultDTO{
			Title: x.Title, URL: x.URL, Snippet: x.Snippet, ImageURL: x.ImageURL, ThumbnailURL: x.ThumbnailURL,
		})
	}
	respondJSON(w, http.StatusOK, out)
}

func (h *aiHandlers) aiCloudImages(w http.ResponseWriter, r *http.Request) {
	userID, orgID, ok := h.resolve(w, r)
	if !ok {
		return
	}
	svc := h.aiCloud(w)
	if svc == nil {
		return
	}
	var in sdi.AiCloudImageSDI
	if !decode(w, r, &in, maxCloudImageBody) {
		return
	}
	refs := make([]service.CloudMedia, 0, len(in.ReferenceImages))
	for _, m := range in.ReferenceImages {
		refs = append(refs, cloudMedia(m))
	}
	res, err := svc.GenerateImage(r.Context(), userID, orgID, service.CloudImageInput{
		Prompt: in.Prompt, AspectRatio: in.AspectRatio, ImageSize: in.ImageSize, ReferenceImages: refs,
	})
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	out := sdo.AiCloudImageSDO{Model: res.Model, Images: make([]sdo.AiCloudMediaDTO, 0, len(res.Images))}
	for _, img := range res.Images {
		out.Images = append(out.Images, sdo.AiCloudMediaDTO{Mime: img.MIME, DataBase64: base64.StdEncoding.EncodeToString(img.Data)})
	}
	respondJSON(w, http.StatusOK, out)
}

func (h *aiHandlers) aiCloudAnalyzeMedia(w http.ResponseWriter, r *http.Request) {
	userID, orgID, ok := h.resolve(w, r)
	if !ok {
		return
	}
	svc := h.aiCloud(w)
	if svc == nil {
		return
	}
	var in sdi.AiCloudAnalyzeSDI
	if !decode(w, r, &in, maxCloudMediaBody) {
		return
	}
	media := make([]service.CloudMedia, 0, len(in.Media))
	for _, m := range in.Media {
		media = append(media, cloudMedia(m))
	}
	text, err := svc.AnalyzeMedia(r.Context(), userID, orgID, service.CloudAnalyzeInput{
		Requirements: in.Requirements, Locale: in.Locale, Media: media,
	})
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, http.StatusOK, sdo.AiCloudTextSDO{Text: text})
}

func (h *aiHandlers) aiCloudTranscribe(w http.ResponseWriter, r *http.Request) {
	userID, orgID, ok := h.resolve(w, r)
	if !ok {
		return
	}
	svc := h.aiCloud(w)
	if svc == nil {
		return
	}
	var in sdi.AiCloudTranscribeSDI
	if !decode(w, r, &in, maxCloudMediaBody) {
		return
	}
	text, err := svc.Transcribe(r.Context(), userID, orgID, service.CloudTranscribeInput{
		Prompt: in.Prompt, Audio: cloudMedia(in.Audio),
	})
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, http.StatusOK, sdo.AiCloudTextSDO{Text: text})
}
