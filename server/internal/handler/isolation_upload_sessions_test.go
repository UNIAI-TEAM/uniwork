package handler

import (
	"bytes"
	"encoding/base64"
	"net/http"
	"testing"

	"github.com/unicomhub/uniwork/server/internal/service"
)

// Large upload sessions in the isolation matrix (BIGUP-S1, contract §5): the
// session table is seeded through the API - the world's Documents service runs
// on a real FileService over the multipart test store - and each route family
// gets one open session for the owner's control. The probes below declare one
// byte over the single-request threshold: the create routes validate the
// declared size and the probe, never the object, so no test moves 20 MiB.

// isoUploadSessionSize is the smallest size the session routes accept.
const isoUploadSessionSize = 20<<20 + 1

// isoUploadSessionHead is the 64 KiB text probe head every session body
// carries: a markdown file's first 64 KiB. Fill it with printable text: the
// probe of a text container refuses a NUL byte (reason text_binary).
var isoUploadSessionHead = base64.StdEncoding.EncodeToString(bytes.Repeat([]byte("a"), int(service.UploadSessionMaxProbeHeadBytes)))

// isoUploadSessionOpen builds a create body for one route family. The key is
// per tenant and per family: the three routes fingerprint different parents,
// so one key across them would be a payload mismatch.
func isoUploadSessionOpen(family string) func(*isoWorld, *isoTenant) isoBody {
	return func(_ *isoWorld, tn *isoTenant) isoBody {
		return isoUploadSessionOpenBody(tn, family, nil)
	}
}

func isoUploadSessionOpenBody(tn *isoTenant, family string, parentID *string) isoBody {
	body := map[string]any{
		"filename":   "iso-big-" + tn.tag + ".md",
		"size_bytes": isoUploadSessionSize,
		"probe": map[string]any{
			"head_b64":        isoUploadSessionHead,
			"central_dir_b64": "",
			"cd_offset":       0,
			"cd_size":         0,
		},
	}
	if parentID != nil {
		body["parent_id"] = *parentID
	}
	return isoBody{json: body, headers: map[string]string{"Idempotency-Key": "iso-upload-session-" + family + "-" + tn.tag}}
}

// isoUploadSessionComplete is the complete body of a session whose parts are
// not uploaded: well-formed, refused 422 upload_parts_invalid, and the reason
// every complete route's write control lists 422.
func isoUploadSessionComplete(*isoWorld, *isoTenant) isoBody {
	return isoBody{json: map[string]any{"parts": []any{}}}
}

// buildUploadSessions opens one session per route family for the tenant's
// owner. Both count against the 4-open-per-person limit, which is why the
// workspace create route's write control is its isoReferences case and not a
// third session in buildTenant.
func (w *isoWorld) buildUploadSessions(t *testing.T, tn *isoTenant) {
	t.Helper()
	status, raw := w.do(t, http.MethodPost, "/api/v1/workspaces/"+tn.wsID+"/documents/upload-sessions", tn.token,
		isoUploadSessionOpenBody(tn, "workspace", nil))
	out := isoExpect(t, http.MethodPost, "workspace upload session", status, raw, http.StatusCreated)
	tn.ids["uploadSession"] = isoString(t, out, "session_id")

	status, raw = w.do(t, http.MethodPost, "/api/v1/office-frame/documents/"+tn.ids["frameMarkdown"]+"/upload-sessions", tn.token,
		isoUploadSessionOpenBody(tn, "frame", nil))
	out = isoExpect(t, http.MethodPost, "frame upload session", status, raw, http.StatusCreated)
	tn.ids["frameUploadSession"] = isoString(t, out, "session_id")
}
