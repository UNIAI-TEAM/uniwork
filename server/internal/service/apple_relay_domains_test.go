package service

import (
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"testing"
)

// Which addresses are Sign in with Apple's Hide My Email relay is decided on
// both sides of the API: appleRelayDomains drives identity resolution, the
// Settings summary (private_relay, account_email_is_relay) and keeping Apple
// on a relay account; core's APPLE_RELAY_DOMAINS drives isAppleRelayEmail,
// which names the address "Email ẩn của Apple" on the web and the phone. A
// domain added on one side only fails quietly — a relay account allowed to
// unlink Apple, or a raw forwarding address on screen — so it fails here,
// in the backend job every pull request runs, whichever side it changed.
// scripts/apple-relay-domains.test.mjs holds the clients' sources the same way.
const clientRelayRules = "../../../packages/core/auth/sign-in-rules.ts"

// clientRelayDomains reads the strings of core's APPLE_RELAY_DOMAINS, and
// fails on any entry that is not a plain string literal: a spread, a constant
// or a template is a domain this check would not see.
func clientRelayDomains(t *testing.T) []string {
	t.Helper()
	src, err := os.ReadFile(clientRelayRules)
	if err != nil {
		t.Fatal(err)
	}
	decl := regexp.MustCompile(`(?m)^export const APPLE_RELAY_DOMAINS(?::[^=]+)? = \[([^\]]*)\]`).FindSubmatch(src)
	if decl == nil {
		t.Fatalf("%s no longer exports APPLE_RELAY_DOMAINS as an array literal", clientRelayRules)
	}
	body := regexp.MustCompile(`//[^\n]*|/\*[\s\S]*?\*/`).ReplaceAll(decl[1], nil)
	literal := regexp.MustCompile(`"([^"\\]*)"|'([^'\\]*)'`)
	var domains []string
	for _, m := range literal.FindAllSubmatch(body, -1) {
		domains = append(domains, string(m[1])+string(m[2]))
	}
	if rest := strings.Trim(string(literal.ReplaceAll(body, nil)), ", \t\r\n"); rest != "" {
		t.Fatalf("%s › APPLE_RELAY_DOMAINS holds an entry that is not a string literal: %q", clientRelayRules, rest)
	}
	return domains
}

func TestAppleRelayDomainsMatchTheClients(t *testing.T) {
	client := clientRelayDomains(t)
	server := make([]string, 0, len(appleRelayDomains))
	for d := range appleRelayDomains {
		server = append(server, d)
	}
	slices.Sort(server)
	sorted := slices.Sorted(slices.Values(client))
	if !slices.Equal(server, sorted) {
		t.Fatalf("appleRelayDomains %v and %s › APPLE_RELAY_DOMAINS %v differ", server, clientRelayRules, sorted)
	}
	lowerDomain := regexp.MustCompile(`^[a-z0-9-]+(\.[a-z0-9-]+)+$`)
	for _, d := range server {
		if !lowerDomain.MatchString(d) {
			t.Errorf("%q is not a lower-case domain", d)
		}
	}
	// Apple keeps forwarding to the addresses it issued before the move.
	for _, d := range []string{"privaterelay.appleid.com", "private.icloud.com"} {
		if !appleRelayDomains[d] {
			t.Errorf("%s is not a relay domain any more", d)
		}
	}
}

// relayDomainWritten matches a relay domain as code may write it: whatever its
// case, its dots escaped or in a class or not, and without its top-level
// label, so a split string ("private.icloud" + ".com") is found too.
func relayDomainWritten(domains map[string]bool) *regexp.Regexp {
	var alts []string
	for d := range domains {
		labels := strings.Split(d, ".")
		for i, l := range labels {
			labels[i] = regexp.QuoteMeta(l)
		}
		alts = append(alts, strings.Join(labels[:len(labels)-1], `(?:\\*\.|\[\.\])`))
	}
	slices.Sort(alts)
	return regexp.MustCompile(`(?i)` + strings.Join(alts, "|"))
}

// structTag is a field's tag: an OpenAPI example or description names an
// address for the reader of the spec, not a rule.
var structTag = regexp.MustCompile("`(?:\\s*[\\w-]+:\"(?:[^\"\\\\]|\\\\.)*\")+\\s*`")

// A copy of the rule elsewhere is the next place a domain goes missing (the
// phone kept one until UNI-2287): only identity_resolve.go names a relay
// domain among the server's sources, the queries and migrations included.
func TestNoOtherServerSourceNamesAnAppleRelayDomain(t *testing.T) {
	written := relayDomainWritten(appleRelayDomains)
	const serverRoot = "../.."
	var copies []string
	err := filepath.WalkDir(serverRoot, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() {
			if path != serverRoot && (strings.HasPrefix(d.Name(), ".") || d.Name() == "vendor" || d.Name() == "testdata") {
				return filepath.SkipDir
			}
			return nil
		}
		rel, err := filepath.Rel(serverRoot, path)
		if err != nil {
			return err
		}
		rel = filepath.ToSlash(rel)
		code := strings.HasSuffix(rel, ".go") && !strings.HasSuffix(rel, "_test.go")
		if (!code && !strings.HasSuffix(rel, ".sql")) || rel == "internal/service/identity_resolve.go" {
			return nil
		}
		src, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		for i, line := range strings.Split(string(src), "\n") {
			if written.MatchString(structTag.ReplaceAllString(line, "")) {
				copies = append(copies, rel+":"+strconv.Itoa(i+1))
			}
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(copies) > 0 {
		t.Fatalf("a relay domain outside identity_resolve.go (use isRelayAddress there instead):\n%s", strings.Join(copies, "\n"))
	}
}
