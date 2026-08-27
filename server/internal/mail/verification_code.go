package mail

import (
	"bytes"
	"embed"
	"fmt"
	"html/template"
	texttemplate "text/template"
)

//go:embed templates/verification_code.html templates/verification_code.txt
var templateFS embed.FS

var (
	verificationHTML = template.Must(template.ParseFS(templateFS, "templates/verification_code.html"))
	verificationText = texttemplate.Must(texttemplate.ParseFS(templateFS, "templates/verification_code.txt"))
)

type verificationData struct {
	Code             string
	ExpiresInMinutes int
}

// VerificationCode renders the email that carries a sign-up verification
// code. The expiry is a parameter so the copy and the service that enforces
// it share one number.
func VerificationCode(to, code string, expiresInMinutes int) (Message, error) {
	data := verificationData{Code: code, ExpiresInMinutes: expiresInMinutes}
	var html, text bytes.Buffer
	if err := verificationHTML.Execute(&html, data); err != nil {
		return Message{}, fmt.Errorf("render verification html: %w", err)
	}
	if err := verificationText.Execute(&text, data); err != nil {
		return Message{}, fmt.Errorf("render verification text: %w", err)
	}
	return Message{
		To:      to,
		Subject: fmt.Sprintf("%s là mã xác thực UniWork của bạn", code),
		HTML:    html.String(),
		Text:    text.String(),
	}, nil
}
