package service

import (
	"path"
	"regexp"
	"sort"
	"strings"
)

// The references a Markdown/HTML document loads by relative path: Markdown
// images and reference definitions, HTML src/href/poster/data attributes,
// srcset entries and CSS url(...) / @import. A scan, not a parser: what it
// over-collects (a link to another page) resolves to nothing, because only
// the types in officeFrameLinkedTypes are ever signed.
var (
	officeFrameMDImage  = regexp.MustCompile(`!\[[^\]\n]*\]\(\s*<?([^)\s>]+)>?`)
	officeFrameMDRefDef = regexp.MustCompile(`(?m)^ {0,3}\[[^\]\n]+\]:[ \t]*<?([^\s>]+)>?`)
	officeFrameAttr     = regexp.MustCompile(`(?i)[\s"'](?:src|href|poster|data)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))`)
	officeFrameSrcset   = regexp.MustCompile(`(?i)[\s"'](?:srcset|imagesrcset)\s*=\s*(?:"([^"]*)"|'([^']*)')`)
	officeFrameCSSURL   = regexp.MustCompile(`(?i)url\(\s*(?:"([^"]*)"|'([^']*)'|([^)\s"']+))\s*\)`)
	officeFrameImport   = regexp.MustCompile(`(?i)@import\s+(?:"([^"]+)"|'([^']+)')`)
)

// officeFrameRefs lists the distinct relative references of content as
// written, in document order, at most officeFrameMaxRefs, keeping only
// those whose extension names a type the frames load.
func officeFrameRefs(content string) []string {
	seen := map[string]bool{}
	var out []string
	add := func(ref string) {
		ref = strings.TrimSpace(ref)
		if ref == "" || seen[ref] || len(out) >= officeFrameMaxRefs {
			return
		}
		segs, ok := officeFramePathSegments(ref)
		if !ok {
			return
		}
		if _, ok := officeFrameLinkedTypes[strings.ToLower(path.Ext(segs[len(segs)-1]))]; !ok {
			return
		}
		seen[ref] = true
		out = append(out, ref)
	}
	firstGroup := func(m []string) string {
		for _, g := range m[1:] {
			if g != "" {
				return g
			}
		}
		return ""
	}
	type match struct {
		at  int
		ref []string
	}
	var found []match
	for _, re := range []*regexp.Regexp{officeFrameMDImage, officeFrameMDRefDef, officeFrameAttr, officeFrameCSSURL, officeFrameImport} {
		for _, idx := range re.FindAllStringSubmatchIndex(content, -1) {
			m := make([]string, len(idx)/2)
			for i := range m {
				if idx[2*i] >= 0 {
					m[i] = content[idx[2*i]:idx[2*i+1]]
				}
			}
			found = append(found, match{at: idx[0], ref: []string{firstGroup(m)}})
		}
	}
	for _, idx := range officeFrameSrcset.FindAllStringSubmatchIndex(content, -1) {
		var list string
		for g := 1; g < len(idx)/2; g++ {
			if idx[2*g] >= 0 {
				list = content[idx[2*g]:idx[2*g+1]]
				break
			}
		}
		var refs []string
		for _, entry := range strings.Split(list, ",") {
			if fields := strings.Fields(entry); len(fields) > 0 {
				refs = append(refs, fields[0])
			}
		}
		found = append(found, match{at: idx[0], ref: refs})
	}
	// Document order, so the cap keeps the first references a reader sees.
	sort.SliceStable(found, func(i, j int) bool { return found[i].at < found[j].at })
	for _, f := range found {
		for _, r := range f.ref {
			add(r)
		}
	}
	return out
}
