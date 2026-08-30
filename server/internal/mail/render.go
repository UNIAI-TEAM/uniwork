package mail

import (
	"bytes"
	"embed"
	"fmt"
	htmltemplate "html/template"
	"strings"
	texttemplate "text/template"
	"unicode"
	"unicode/utf8"
)

//go:embed templates/*.html templates/*.txt
var templateFS embed.FS

var kinds = []string{KindVerificationCode, KindPasswordReset, KindWorkspaceInvite, KindWelcome}
var locales = []string{"vi", "en"}

// One parsed pair per kind×locale; a missing file panics at boot, which is
// the earliest a template mistake can surface.
var (
	htmlTemplates = map[string]*htmltemplate.Template{}
	textTemplates = map[string]*texttemplate.Template{}
)

func init() {
	for _, k := range kinds {
		for _, l := range locales {
			key := k + "." + l
			htmlTemplates[key] = htmltemplate.Must(htmltemplate.ParseFS(templateFS, "templates/layout.html", "templates/"+key+".html"))
			textTemplates[key] = texttemplate.Must(texttemplate.ParseFS(templateFS, "templates/"+key+".txt"))
		}
	}
}

// Renderer builds Messages. AppURL is FRONTEND_ORIGIN; every link in a mail
// starts with it. Services hold a Renderer by value.
type Renderer struct {
	AppURL string
}

// layoutData is what every template sees: the kind's data plus the app URL
// for links and the footer.
type layoutData struct {
	AppURL string
	Data   any
}

func normalizeLocale(l string) string {
	if l == "en" {
		return "en"
	}
	return "vi"
}

// renderKind executes the html (through layout) and text templates. The
// text file's first line is "Subject: …"; it is the subject for both parts.
func renderKind(kind, locale, appURL string, data any) (subject, html, text string, err error) {
	key := kind + "." + locale
	if htmlTemplates[key] == nil || textTemplates[key] == nil {
		return "", "", "", fmt.Errorf("mail: no template for %s", key)
	}
	ld := layoutData{AppURL: appURL, Data: data}
	var hb, tb bytes.Buffer
	if err := htmlTemplates[key].ExecuteTemplate(&hb, "layout", ld); err != nil {
		return "", "", "", fmt.Errorf("render %s html: %w", key, err)
	}
	if err := textTemplates[key].Execute(&tb, ld); err != nil {
		return "", "", "", fmt.Errorf("render %s text: %w", key, err)
	}
	raw := tb.String()
	first, rest, _ := strings.Cut(raw, "\n")
	if !strings.HasPrefix(first, "Subject:") {
		return "", "", "", fmt.Errorf("render %s: text template must start with 'Subject:'", key)
	}
	subject = sanitizeSubject(strings.TrimSpace(strings.TrimPrefix(first, "Subject:")))
	return subject, hb.String(), strings.TrimLeft(rest, "\n"), nil
}

const maxSubjectRunes = 200
const maxFieldRunes = 60

// sanitizeSubject drops control characters (header injection) and caps length.
func sanitizeSubject(s string) string { return stripControl(s, maxSubjectRunes) }

// SafeField prepares user-controlled text (display name, workspace name) for
// a subject or body: no control characters, at most 60 runes so a workspace
// name cannot become a phishing subject.
func SafeField(s string) string { return stripControl(s, maxFieldRunes) }

func stripControl(s string, max int) string {
	var b strings.Builder
	for _, r := range s {
		if !unicode.IsControl(r) {
			b.WriteRune(r)
		}
	}
	out := strings.TrimSpace(b.String())
	if utf8.RuneCountInString(out) <= max {
		return out
	}
	return string([]rune(out)[:max-1]) + "…"
}
