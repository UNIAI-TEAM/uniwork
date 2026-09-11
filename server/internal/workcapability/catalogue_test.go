package workcapability

import "testing"

func TestCatalogueMatchesInitialRolloutContract(t *testing.T) {
	got := Catalogue()
	want := map[string]Entry{
		"tasks.core": {
			Status: Available,
		},
		"tasks.projects": {
			Status: Available,
		},
		"tasks.attachments": {
			Status: Available,
		},
		"tasks.agent_runs": {
			Status:         Unavailable,
			ReasonCode:     "agent_runtime_missing",
			ExplanationKey: "capabilities.agent_runtime_missing",
		},
		"tasks.squads": {
			Status:         Unavailable,
			ReasonCode:     "squad_directory_missing",
			ExplanationKey: "capabilities.squad_directory_missing",
		},
		"tasks.vcs": {
			Status:         Unavailable,
			ReasonCode:     "vcs_provider_missing",
			ExplanationKey: "capabilities.vcs_provider_missing",
		},
		"tasks.local_workdir": {
			Status:         Unavailable,
			ReasonCode:     "local_daemon_missing",
			ExplanationKey: "capabilities.local_daemon_missing",
		},
		"desktop.host": {
			Status:         Unavailable,
			ReasonCode:     "host_not_built",
			ExplanationKey: "capabilities.host_not_built",
		},
		"mobile.host": {
			Status:         Unavailable,
			ReasonCode:     "host_not_built",
			ExplanationKey: "capabilities.host_not_built",
		},
	}
	for key, entry := range want {
		if got[key] != entry {
			t.Fatalf("%s = %+v, want %+v", key, got[key], entry)
		}
	}
	delete(got, "tasks.core")
	if _, ok := Catalogue()["tasks.core"]; !ok {
		t.Fatal("Catalogue leaked mutable map")
	}
}
