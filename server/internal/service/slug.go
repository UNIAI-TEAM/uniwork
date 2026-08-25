package service

import (
	_ "embed"
	"encoding/json"
	"regexp"
)

//go:embed reserved_slugs.json
var reservedSlugsJSON []byte

var reservedSlugs = func() map[string]bool {
	var list []string
	if err := json.Unmarshal(reservedSlugsJSON, &list); err != nil {
		panic("reserved_slugs.json: " + err.Error())
	}
	m := make(map[string]bool, len(list))
	for _, s := range list {
		m[s] = true
	}
	return m
}()

// slugPattern: chữ thường/số, nhóm cách nhau bởi 1 dấu gạch; 2–40 ký tự.
var slugPattern = regexp.MustCompile(`^[a-z0-9]+(?:-[a-z0-9]+)*$`)

// ValidateSlug dùng chung cho org và workspace.
func ValidateSlug(slug string) error {
	if len(slug) < 2 || len(slug) > 40 || !slugPattern.MatchString(slug) {
		return Invalid("định danh chỉ gồm a-z, 0-9 và dấu gạch ngang (2-40 ký tự)")
	}
	if reservedSlugs[slug] {
		return Invalid("định danh này được hệ thống dành riêng")
	}
	return nil
}

func ReservedSlugs() []string {
	out := make([]string, 0, len(reservedSlugs))
	for s := range reservedSlugs {
		out = append(out, s)
	}
	return out
}
