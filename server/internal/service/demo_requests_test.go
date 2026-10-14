package service

import (
	"context"
	"github.com/unicomhub/uniwork/server/internal/util"
	"testing"
)

func TestDemoRequestValidation(t *testing.T) {
	good := CreateDemoRequestInput{FullName: "Lan", WorkEmail: "lan@example.com", CompanyName: "Acme", TeamSize: "11-50", Locale: "vi", RequestKey: util.NewID()}
	for _, mutate := range []func(*CreateDemoRequestInput){
		func(in *CreateDemoRequestInput) { in.FullName = " " },
		func(in *CreateDemoRequestInput) { in.WorkEmail = "not-email" },
		func(in *CreateDemoRequestInput) { in.CompanyName = "" },
		func(in *CreateDemoRequestInput) { in.TeamSize = "unknown" },
		func(in *CreateDemoRequestInput) { in.Locale = "xx" },
		func(in *CreateDemoRequestInput) { in.RequestKey = "" },
	} {
		in := good
		mutate(&in)
		if err := validateDemoRequest(&in); err == nil {
			t.Fatal("invalid demo request accepted")
		}
	}
	if err := validateDemoRequest(&good); err != nil {
		t.Fatal(err)
	}
}

func TestDemoRequestIntakeAndAdminProcessing(t *testing.T) {
	f := newAuditFixture(t)
	ctx := context.Background()
	svc := NewDemoRequestService(f.pool, f.q)
	in := CreateDemoRequestInput{FullName: "Lan", WorkEmail: "lan@example.com", CompanyName: "Acme", TeamSize: "11-50", Message: "Show our project workflow", Locale: "vi", RequestKey: util.NewID()}
	first, err := svc.Create(ctx, in)
	if err != nil {
		t.Fatal(err)
	}
	again, err := svc.Create(ctx, in)
	if err != nil || again != first {
		t.Fatalf("idempotency: %s %v", again, err)
	}
	page, err := f.admin.ListDemoRequests(ctx, "new", 20, 0)
	if err != nil || page.Total != 1 || len(page.Requests) != 1 {
		t.Fatalf("intake: %+v %v", page, err)
	}
	if _, err := f.admin.UpdateDemoRequest(ctx, CLIActor, first, "completed", "short"); err == nil {
		t.Fatal("short reason accepted")
	}
	if _, err := f.admin.UpdateDemoRequest(ctx, CLIActor, first, "bogus", "Requested an update"); err == nil {
		t.Fatal("unknown status accepted")
	}
	row, err := f.admin.UpdateDemoRequest(ctx, CLIActor, first, "in_progress", "Contacted the requester")
	if err != nil || row.Status != "in_progress" {
		t.Fatalf("process: %+v %v", row, err)
	}
	page, err = f.admin.ListDemoRequests(ctx, "new", 20, 0)
	if err != nil || page.Total != 0 {
		t.Fatalf("filter: %+v %v", page, err)
	}
}
