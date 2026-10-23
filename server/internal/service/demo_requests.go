package service

import (
	"context"
	"errors"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
	"net/mail"
	"strings"
	"unicode/utf8"
)

type DemoRequestService struct {
	pool *pgxpool.Pool
	q    *db.Queries
}

func NewDemoRequestService(pool *pgxpool.Pool, q *db.Queries) *DemoRequestService {
	return &DemoRequestService{pool: pool, q: q}
}

type CreateDemoRequestInput struct{ FullName, WorkEmail, CompanyName, TeamSize, Message, Locale, RequestKey string }

func validateDemoRequest(in *CreateDemoRequestInput) error {
	in.FullName = strings.TrimSpace(in.FullName)
	in.WorkEmail = strings.ToLower(strings.TrimSpace(in.WorkEmail))
	in.CompanyName = strings.TrimSpace(in.CompanyName)
	in.Message = strings.TrimSpace(in.Message)
	addr, err := mail.ParseAddress(in.WorkEmail)
	if err != nil || addr.Address != in.WorkEmail || len(in.WorkEmail) > 254 {
		return ValidationError{Msg: "work_email không hợp lệ"}
	}
	if in.FullName == "" || utf8.RuneCountInString(in.FullName) > 120 || in.CompanyName == "" || utf8.RuneCountInString(in.CompanyName) > 160 || utf8.RuneCountInString(in.Message) > 2000 {
		return ValidationError{Msg: "thông tin yêu cầu demo không hợp lệ"}
	}
	switch in.TeamSize {
	case "1-10", "11-50", "51-200", "201-1000", "1000+":
	default:
		return ValidationError{Msg: "team_size không hợp lệ"}
	}
	if in.Locale != "en" && in.Locale != "vi" {
		return ValidationError{Msg: "locale không hợp lệ"}
	}
	if len(in.RequestKey) < 8 || len(in.RequestKey) > 64 {
		return ValidationError{Msg: "Idempotency-Key không hợp lệ"}
	}
	return nil
}

func (s *DemoRequestService) Create(ctx context.Context, in CreateDemoRequestInput) (string, error) {
	if err := validateDemoRequest(&in); err != nil {
		return "", err
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return "", err
	}
	defer tx.Rollback(ctx)
	q := s.q.WithTx(tx)
	id, err := q.CreateDemoRequest(ctx, db.CreateDemoRequestParams{ID: util.NewID(), RequestKey: in.RequestKey, FullName: in.FullName, WorkEmail: in.WorkEmail, CompanyName: in.CompanyName, TeamSize: in.TeamSize, Message: in.Message, Locale: in.Locale})
	if errors.Is(err, pgx.ErrNoRows) {
		return q.GetDemoRequestReceipt(ctx, in.RequestKey)
	}
	if err != nil {
		return "", err
	}
	// The system accepts an anonymous form; personal fields remain only in the intake row.
	if err := auditRecorder.Record(ctx, q, audit.Entry{OrganizationID: audit.NoOrganization, Actor: audit.System("demo-request-intake"), Action: audit.ActionDemoRequestCreated, ResourceType: "demo_request", ResourceID: id, Metadata: map[string]any{"source": "public_form"}}); err != nil {
		return "", err
	}
	if err := tx.Commit(ctx); err != nil {
		return "", err
	}
	return id, nil
}
