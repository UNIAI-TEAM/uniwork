package handler

import (
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

func TestTaskDTOIncludesCardMetadata(t *testing.T) {
	start := time.Date(2026, time.September, 9, 0, 0, 0, 0, time.UTC)
	task := db.Task{
		Number:    12,
		StartDate: pgtype.Date{Time: start, Valid: true},
		ProjectID: pgtype.Text{String: "project-1", Valid: true},
		CreatedAt: pgtype.Timestamptz{Time: start, Valid: true},
		UpdatedAt: pgtype.Timestamptz{Time: start, Valid: true},
	}

	dto := toTaskDTO(task, "SAT")
	if dto.StartDate == nil || *dto.StartDate != "2026-09-09" {
		t.Fatalf("StartDate = %v, want 2026-09-09", dto.StartDate)
	}
	if dto.ProjectID == nil || *dto.ProjectID != "project-1" {
		t.Fatalf("ProjectID = %v, want project-1", dto.ProjectID)
	}
}
