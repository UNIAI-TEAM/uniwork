package ai

import (
	"strings"
	"testing"
)

// The model names an attachment by the id the prompt prints beside its name;
// a file without a stored row prints none.
func TestRenderAttachedFilesShowsTheAttachmentID(t *testing.T) {
	var b strings.Builder
	renderAttachedFiles(&b, []AttachedFile{
		{ID: "att1", Name: "Bao gia.docx", Kind: "text", Text: "x", Unit: "paragraph"},
		{Name: "khong-id.txt", Kind: "text", Text: "y", Unit: "line"},
	})
	got := b.String()
	if want := `File 1: <untrusted source="file_name">Bao gia.docx</untrusted> (attachment_id: att1)` + "\n"; !strings.Contains(got, want) {
		t.Errorf("prompt = %q; want the line %q", got, want)
	}
	if want := `File 2: <untrusted source="file_name">khong-id.txt</untrusted>` + "\n"; !strings.Contains(got, want) {
		t.Errorf("prompt = %q; want the line %q with no attachment id", got, want)
	}
}
