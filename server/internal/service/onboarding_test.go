package service

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
)

func TestQuestionnaireAndComplete(t *testing.T) {
	f := wsFixture(t)
	ctx := context.Background()
	s := NewOnboardingService(f.q, f.ws, NopPublisher{})

	u, err := s.PatchQuestionnaire(ctx, f.ua.ID, json.RawMessage(`{"version":1,"role":"engineer","use_case":["team_tasks","other"],"use_case_other":"khác"}`))
	if err != nil || !strings.Contains(string(u.OnboardingQuestionnaire), `"engineer"`) {
		t.Fatalf("patch: %v %s", err, u.OnboardingQuestionnaire)
	}
	if _, err := s.PatchQuestionnaire(ctx, f.ua.ID, json.RawMessage(`{"role":"wizard"}`)); err == nil {
		t.Fatal("bad role accepted")
	}
	if _, err := s.PatchQuestionnaire(ctx, f.ua.ID, json.RawMessage(`[1,2]`)); err == nil {
		t.Fatal("non-object accepted")
	}
	big := `{"role_other":"` + strings.Repeat("x", 20000) + `"}`
	if _, err := s.PatchQuestionnaire(ctx, f.ua.ID, json.RawMessage(big)); err == nil {
		t.Fatal("oversized accepted")
	}
	// nil = giữ nguyên
	u2, _ := s.PatchQuestionnaire(ctx, f.ua.ID, nil)
	if string(u2.OnboardingQuestionnaire) != string(u.OnboardingQuestionnaire) {
		t.Fatal("nil patch changed questionnaire")
	}

	if u.OnboardedAt.Valid {
		t.Fatal("should not be onboarded yet")
	}
	u3, err := s.Complete(ctx, f.ua.ID, "full", "")
	if err != nil || !u3.OnboardedAt.Valid {
		t.Fatalf("complete: %v", err)
	}
	u4, _ := s.Complete(ctx, f.ua.ID, "skip_existing", "")
	if !u4.OnboardedAt.Time.Equal(u3.OnboardedAt.Time) {
		t.Fatal("complete not idempotent")
	}
	if _, err := s.Complete(ctx, f.ua.ID, "bogus", ""); err == nil {
		t.Fatal("bad path accepted")
	}
}

func TestSeedWelcomeTask(t *testing.T) {
	f := wsFixture(t)
	ctx := context.Background()
	s := NewOnboardingService(f.q, f.ws, NopPublisher{})
	w, _ := f.ws.CreateInOrg(ctx, f.ua.ID, f.org.ID, "Đội Alpha", "doi-alpha")

	task, created, err := s.SeedWelcomeTask(ctx, f.ua.ID, w.ID)
	if err != nil || !created || task.Kind != "welcome" || task.Status != "in_progress" || task.Priority != "high" {
		t.Fatalf("seed: %v created=%v %+v", err, created, task)
	}
	if !task.AssigneeID.Valid || task.AssigneeID.String != f.ua.ID {
		t.Fatal("welcome task must be assigned to caller")
	}
	again, created2, err := s.SeedWelcomeTask(ctx, f.ua.ID, w.ID)
	if err != nil || created2 || again.ID != task.ID {
		t.Fatalf("seed twice: %v created=%v", err, created2)
	}
	if _, _, err := s.SeedWelcomeTask(ctx, f.ub.ID, w.ID); err != ErrForbidden {
		t.Fatalf("outsider seed: %v", err)
	}
}
