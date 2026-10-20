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
		Number:       12,
		StartDate:    pgtype.Date{Time: start, Valid: true},
		ProjectID:    pgtype.Text{String: "project-1", Valid: true},
		ParentTaskID: pgtype.Text{String: "parent-1", Valid: true},
		CreatedAt:    pgtype.Timestamptz{Time: start, Valid: true},
		UpdatedAt:    pgtype.Timestamptz{Time: start, Valid: true},
	}

	dto := toTaskDTO(task, "SAT")
	if dto.StartDate == nil || *dto.StartDate != "2026-09-09" {
		t.Fatalf("StartDate = %v, want 2026-09-09", dto.StartDate)
	}
	if dto.ProjectID == nil || *dto.ProjectID != "project-1" {
		t.Fatalf("ProjectID = %v, want project-1", dto.ProjectID)
	}
	if dto.ParentTaskID == nil || *dto.ParentTaskID != "parent-1" {
		t.Fatalf("ParentTaskID = %v, want parent-1", dto.ParentTaskID)
	}
}

func TestTaskDTOCarriesOrigin(t *testing.T) {
	dto := toTaskDTO(db.Task{
		OriginType: pgtype.Text{String: "meeting", Valid: true},
		OriginID:   pgtype.Text{String: "meeting-1", Valid: true},
	}, "SAT")
	if dto.OriginType == nil || *dto.OriginType != "meeting" {
		t.Fatalf("OriginType = %v, want meeting", dto.OriginType)
	}
	if dto.OriginID == nil || *dto.OriginID != "meeting-1" {
		t.Fatalf("OriginID = %v, want meeting-1", dto.OriginID)
	}

	plain := toTaskDTO(db.Task{}, "SAT")
	if plain.OriginType != nil || plain.OriginID != nil {
		t.Fatalf("origin = %v/%v, want both nil for a task with no origin", plain.OriginType, plain.OriginID)
	}
}
