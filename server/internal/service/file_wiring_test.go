package service

import "testing"

// The composition root's provider set must answer for every file_id column
// the collector catalogues, and name nothing the catalogue does not know.
func TestFileReferenceProvidersCoverTheCatalogue(t *testing.T) {
	got := map[string]bool{}
	for _, p := range FileReferenceProviders(&ChatService{}, &MeetingService{}) {
		if got[p.Name()] {
			t.Fatalf("provider %q registered twice", p.Name())
		}
		got[p.Name()] = true
	}
	want := map[string]bool{}
	for _, src := range managedFileReferenceSources() {
		want[src.Provider] = true
		if !got[src.Provider] {
			t.Errorf("%s.%s has no provider %q in FileReferenceProviders", src.Table, src.Column, src.Provider)
		}
	}
	for name := range got {
		if !want[name] {
			t.Errorf("provider %q covers no catalogued column", name)
		}
	}
}
