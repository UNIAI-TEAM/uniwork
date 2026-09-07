package workcapability

import "testing"

func TestCatalogueMatchesInitialRolloutContract(t *testing.T) {
	got := Catalogue()
	want := map[string]Status{
		"tasks.core": Available, "tasks.projects": Unavailable, "tasks.attachments": Unavailable,
		"tasks.agent_runs": Unavailable, "tasks.squads": Unavailable,
		"tasks.vcs": Unavailable, "tasks.local_workdir": Unavailable,
		"desktop.host": Unavailable, "mobile.host": Unavailable,
	}
	for key, status := range want {
		if got[key].Status != status {
			t.Fatalf("%s = %+v", key, got[key])
		}
		if status == Unavailable && got[key].ReasonCode == "" {
			t.Fatalf("%s has no reason", key)
		}
	}
	delete(got, "tasks.core")
	if _, ok := Catalogue()["tasks.core"]; !ok {
		t.Fatal("Catalogue leaked mutable map")
	}
}
