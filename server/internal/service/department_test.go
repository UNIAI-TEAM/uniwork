package service

import (
	"errors"
	"testing"
)

func TestDepartmentTreeIsTwoLevelsDeep(t *testing.T) {
	f := newPeopleFixture(t)
	parent, err := f.depts.Create(f.ctx, f.owner.ID, f.org.ID, DepartmentInput{Name: strptr("Kỹ thuật")})
	if err != nil {
		t.Fatal(err)
	}
	child, err := f.depts.Create(f.ctx, f.owner.ID, f.org.ID, DepartmentInput{Name: strptr("Backend"), ParentID: &parent.ID})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.depts.Create(f.ctx, f.owner.ID, f.org.ID, DepartmentInput{Name: strptr("Go"), ParentID: &child.ID}); err == nil {
		t.Fatal("a third level was accepted")
	}
	// Re-parenting cannot smuggle a third level in either.
	other, err := f.depts.Create(f.ctx, f.owner.ID, f.org.ID, DepartmentInput{Name: strptr("Kinh doanh")})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.depts.Update(f.ctx, f.owner.ID, f.org.ID, parent.ID, DepartmentInput{ParentID: &other.ID}); err == nil {
		t.Fatal("a department with children was allowed under a parent")
	}
	if _, err := f.depts.Update(f.ctx, f.owner.ID, f.org.ID, other.ID, DepartmentInput{ParentID: &other.ID}); err == nil {
		t.Fatal("a department became its own parent")
	}
}

func TestDepartmentCodeIsUniqueWithinOneOrganization(t *testing.T) {
	f := newPeopleFixture(t)
	if _, err := f.depts.Create(f.ctx, f.owner.ID, f.org.ID, DepartmentInput{Name: strptr("Kỹ thuật"), Code: strptr("eng")}); err != nil {
		t.Fatal(err)
	}
	// Codes are folded to upper case, so "eng" and "ENG" are the same code.
	if _, err := f.depts.Create(f.ctx, f.owner.ID, f.org.ID, DepartmentInput{Name: strptr("Khác"), Code: strptr("ENG")}); err == nil {
		t.Fatal("a duplicate department code was accepted")
	}
	// A different organization may use the same code.
	second, err := f.orgs.Create(f.ctx, f.other.ID, "Khác", "khac")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.depts.Create(f.ctx, f.other.ID, second.ID, DepartmentInput{Name: strptr("Kỹ thuật"), Code: strptr("ENG")}); err != nil {
		t.Fatalf("the same code in another organization: %v", err)
	}
}

func TestArchivingADepartmentMovesItsPeopleOut(t *testing.T) {
	f := newPeopleFixture(t)
	d, err := f.depts.Create(f.ctx, f.owner.ID, f.org.ID, DepartmentInput{Name: strptr("Kỹ thuật")})
	if err != nil {
		t.Fatal(err)
	}
	child, err := f.depts.Create(f.ctx, f.owner.ID, f.org.ID, DepartmentInput{Name: strptr("Backend"), ParentID: &d.ID})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.people.UpdateProfile(f.ctx, f.owner.ID, f.org.ID, f.member.ID, ProfileInput{DepartmentID: &d.ID}); err != nil {
		t.Fatal(err)
	}
	// A department with children keeps them: archive the leaves first.
	if _, err := f.depts.Archive(f.ctx, f.owner.ID, f.org.ID, d.ID); err == nil {
		t.Fatal("a department with children was archived")
	}
	if _, err := f.depts.Archive(f.ctx, f.owner.ID, f.org.ID, child.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := f.depts.Archive(f.ctx, f.owner.ID, f.org.ID, d.ID); err != nil {
		t.Fatal(err)
	}
	person, _, err := f.people.Get(f.ctx, f.owner.ID, f.org.ID, f.member.ID)
	if err != nil {
		t.Fatal(err)
	}
	if person.DepartmentID != "" {
		t.Fatalf("the member still points at an archived department: %q", person.DepartmentID)
	}
	// And the archived name no longer matches in the directory.
	page, err := f.people.Search(f.ctx, f.owner.ID, f.org.ID, PeopleFilter{Query: "ky thuat"})
	if err != nil || len(page.People) != 0 {
		t.Fatalf("archived department still searchable: %v, %d rows", err, len(page.People))
	}
	list, err := f.depts.List(f.ctx, f.owner.ID, f.org.ID, false)
	if err != nil || len(list) != 0 {
		t.Fatalf("archived departments listed: %v %+v", err, list)
	}
	all, err := f.depts.List(f.ctx, f.owner.ID, f.org.ID, true)
	if err != nil || len(all) != 2 {
		t.Fatalf("include_archived: %v %d rows", err, len(all))
	}
}

func TestOnlyAdminsShapeTheOrganization(t *testing.T) {
	f := newPeopleFixture(t)
	if _, err := f.depts.Create(f.ctx, f.member.ID, f.org.ID, DepartmentInput{Name: strptr("Kỹ thuật")}); !errors.Is(err, ErrForbidden) {
		t.Fatalf("member creating a department: got %v", err)
	}
	// Reading the tree is open to every member: the picker needs it.
	if _, err := f.depts.List(f.ctx, f.member.ID, f.org.ID, false); err != nil {
		t.Fatalf("member listing departments: %v", err)
	}
	if _, err := f.depts.List(f.ctx, f.other.ID, f.org.ID, false); !errors.Is(err, ErrForbidden) {
		t.Fatalf("outsider listing departments: got %v", err)
	}
}

func TestReorderWritesTheDisplayOrder(t *testing.T) {
	f := newPeopleFixture(t)
	var ids []string
	for _, name := range []string{"A", "B", "C"} {
		d, err := f.depts.Create(f.ctx, f.owner.ID, f.org.ID, DepartmentInput{Name: strptr(name)})
		if err != nil {
			t.Fatal(err)
		}
		ids = append(ids, d.ID)
	}
	reversed := []string{ids[2], ids[1], ids[0]}
	rows, err := f.depts.Reorder(f.ctx, f.owner.ID, f.org.ID, reversed)
	if err != nil {
		t.Fatal(err)
	}
	got := make([]string, 0, len(rows))
	for _, r := range rows {
		got = append(got, r.ID)
	}
	if len(got) != 3 || got[0] != reversed[0] || got[2] != reversed[2] {
		t.Fatalf("order after reorder: %v, want %v", got, reversed)
	}
}
