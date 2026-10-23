package service

import (
	"testing"

	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

func TestValidateTaskViewVariant(t *testing.T) {
	t.Parallel()
	assigned := "assigned"
	got, err := validateTaskViewVariant("my", &assigned)
	if err != nil || !got.Valid || got.String != "assigned" {
		t.Fatalf("%+v %v", got, err)
	}
	if _, err := validateTaskViewVariant("my", nil); err == nil {
		t.Fatal("my requires variant")
	}
	bad := "nope"
	if _, err := validateTaskViewVariant("my", &bad); err == nil {
		t.Fatal("my bad variant")
	}
	empty, err := validateTaskViewVariant("workspace", nil)
	if err != nil || empty.Valid {
		t.Fatalf("nil workspace variant %+v %v", empty, err)
	}
	all := "all"
	empty, err = validateTaskViewVariant("workspace", &all)
	if err != nil || empty.Valid {
		t.Fatalf("all is empty %+v %v", empty, err)
	}
	members := "members"
	got, err = validateTaskViewVariant("workspace", &members)
	if err != nil || !got.Valid || got.String != "members" {
		t.Fatalf("%+v %v", got, err)
	}
	if _, err := validateTaskViewVariant("workspace", &bad); err == nil {
		t.Fatal("workspace bad variant")
	}
}

func TestCanReadTaskView(t *testing.T) {
	t.Parallel()
	if !canReadTaskView(db.TaskView{OwnerID: "u1", Visibility: "private"}, "u1") {
		t.Fatal("owner")
	}
	if canReadTaskView(db.TaskView{OwnerID: "u1", Visibility: "private"}, "u2") {
		t.Fatal("private stranger")
	}
	if !canReadTaskView(db.TaskView{OwnerID: "u1", Visibility: "workspace"}, "u2") {
		t.Fatal("workspace")
	}
}
