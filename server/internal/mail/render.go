package mail

import (
	"bytes"
	"embed"
	"fmt"
	htmltemplate "html/template"
	"strings"
	texttemplate "text/template"
	"time"
	"unicode"
	"unicode/utf8"
)

//go:embed templates/*.html templates/*.txt
var templateFS embed.FS

var kinds = []string{KindVerificationCode, KindPasswordReset, KindWorkspaceInvite, KindOrganizationInvite, KindWelcome, KindNotificationDigest, KindNewLogin}
var locales = []string{"vi", "en"}

// One parsed pair per kind×locale; a missing file panics at boot, which is
// the earliest a template mistake can surface.
var (
	htmlTemplates = map[string]*htmltemplate.Template{}
	textTemplates = map[string]*texttemplate.Template{}
)

// Template helpers. html/template strips HTML comments, which is exactly
// what Outlook's conditional comments are, so anything Outlook-only goes
// through raw or button and is inserted as trusted HTML.
var (
	htmlFuncs = htmltemplate.FuncMap{"raw": raw, "button": button, "expires": expires}
	textFuncs = texttemplate.FuncMap{"expires": expires}
)

func init() {
	for _, k := range kinds {
		for _, l := range locales {
			key := k + "." + l
			htmlTemplates[key] = htmltemplate.Must(htmltemplate.New("mail").Funcs(htmlFuncs).ParseFS(templateFS, "templates/layout.html", "templates/"+key+".html"))
			textTemplates[key] = texttemplate.Must(texttemplate.New("mail").Funcs(textFuncs).ParseFS(templateFS, "templates/"+key+".txt"))
		}
	}
}

// raw marks a template literal as HTML. Only for static markup written in
// the template files themselves, never for data.
func raw(s string) htmltemplate.HTML { return htmltemplate.HTML(s) }

// button renders the one CTA style every mail uses: a table-cell button for
// everyone and a VML roundrect for Outlook's Word engine, which ignores
// padding on <a> and border-radius everywhere. href and label are escaped
// here because the result bypasses html/template's own escaping.
func button(href, label string) htmltemplate.HTML {
	h := htmltemplate.HTMLEscapeString(href)
	l := htmltemplate.HTMLEscapeString(label)
	return htmltemplate.HTML(`<!--[if mso]><v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="` + h + `" style="height:48px;v-text-anchor:middle;width:240px" arcsize="21%" stroke="f" fillcolor="#202020"><w:anchorlock/><center style="color:#ffffff;font-family:'Segoe UI',Arial,sans-serif;font-size:15px;font-weight:600">` + l + `</center></v:roundrect><![endif]-->` +
		`<!--[if !mso]><!--><table role="presentation" cellspacing="0" cellpadding="0" border="0"><tr><td style="background:#202020;border-radius:10px"><a href="` + h + `" style="display:inline-block;padding:14px 24px;font-size:15px;line-height:20px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:10px">` + l + `</a></td></tr></table><!--<![endif]-->`)
}

// expires renders a TTL the way people say it: whole days as days, whole
// hours as hours, anything else as minutes. The service that enforces the
// TTL passes the same Duration, so copy and behaviour cannot drift.
func expires(d time.Duration, locale string) string {
	vi := normalizeLocale(locale) == "vi"
	unit := func(n int64, viWord, enWord string) string {
		if vi {
			return fmt.Sprintf("%d %s", n, viWord)
		}
		if n == 1 {
			return fmt.Sprintf("1 %s", enWord)
		}
		return fmt.Sprintf("%d %ss", n, enWord)
	}
	switch {
	case d >= 24*time.Hour && d%(24*time.Hour) == 0:
		return unit(int64(d/(24*time.Hour)), "ngày", "day")
	case d >= time.Hour && d%time.Hour == 0:
		return unit(int64(d/time.Hour), "giờ", "hour")
	default:
		return unit(int64(d/time.Minute), "phút", "minute")
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
	Locale string
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
	ld := layoutData{AppURL: appURL, Locale: locale, Data: data}
	var hb, tb bytes.Buffer
	if err := htmlTemplates[key].ExecuteTemplate(&hb, "layout", ld); err != nil {
		return "", "", "", fmt.Errorf("render %s html: %w", key, err)
	}
	if err := textTemplates[key].ExecuteTemplate(&tb, key+".txt", ld); err != nil {
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
