package service

import (
	"errors"
	"net/http"
	netmail "net/mail"
	"net/netip"
	"strings"
	"unicode"
	"unicode/utf8"

	"golang.org/x/net/idna"

	"github.com/unicomhub/uniwork/server/internal/emailhub"
	"github.com/unicomhub/uniwork/server/internal/emailhub/netguard"
)

var (
	ErrEmailHubInvalidServer  = errors.New("invalid mail server settings")
	ErrEmailHubHostNotAllowed = errors.New("mail server address not allowed")
)

// emailHubServer is the one resolved server a connect verifies, stores and
// compares against the existing row. Hosts are already normalized.
type emailHubServer struct {
	Provider     string
	IMAPHost     string
	IMAPPort     int
	IMAPSecurity string
	SMTPHost     string
	SMTPPort     int
	SMTPSecurity string
	Username     string
}

// resolveEmailHubServer turns a connect request into one server without
// dialling (spec §5.2 step 2). email is the trimmed, lowercased address. With
// no server field the preset for the domain applies; with any server field all
// six are required and the provider is "custom".
func resolveEmailHubServer(email string, in ConnectEmailHubInput) (emailHubServer, error) {
	if a, err := netmail.ParseAddress(email); err != nil || a.Address != email || strings.ContainsAny(email, "\r\n") {
		return emailHubServer{}, Invalid("invalid email address")
	}
	if in.IMAPHost == "" && in.IMAPPort == 0 && in.IMAPSecurity == "" &&
		in.SMTPHost == "" && in.SMTPPort == 0 && in.SMTPSecurity == "" && in.Username == "" {
		prov, ok := emailhub.ProviderForEmail(email)
		if !ok {
			return emailHubServer{}, ErrEmailHubUnsupported
		}
		return presetEmailHubServer(prov), nil
	}
	imapHost, err := resolveEmailHubEndpoint("imap", in.IMAPHost, in.IMAPPort, in.IMAPSecurity)
	if err != nil {
		return emailHubServer{}, err
	}
	smtpHost, err := resolveEmailHubEndpoint("smtp", in.SMTPHost, in.SMTPPort, in.SMTPSecurity)
	if err != nil {
		return emailHubServer{}, err
	}
	username := strings.TrimSpace(in.Username)
	if utf8.RuneCountInString(username) > 320 || strings.IndexFunc(username, unicode.IsControl) >= 0 {
		return emailHubServer{}, emailHubServerFieldError(ErrEmailHubInvalidServer, "username")
	}
	return emailHubServer{
		Provider: "custom", IMAPHost: imapHost, IMAPPort: in.IMAPPort, IMAPSecurity: in.IMAPSecurity,
		SMTPHost: smtpHost, SMTPPort: in.SMTPPort, SMTPSecurity: in.SMTPSecurity, Username: username,
	}, nil
}

// presetEmailHubServer is a provider preset as the server a connect stores:
// implicit TLS for IMAP, STARTTLS for SMTP, the address as the login.
func presetEmailHubServer(prov emailhub.Provider) emailHubServer {
	return emailHubServer{
		Provider: prov.Name, IMAPHost: prov.IMAPHost, IMAPPort: prov.IMAPPort, IMAPSecurity: "tls",
		SMTPHost: prov.SMTPHost, SMTPPort: prov.SMTPPort, SMTPSecurity: "starttls",
	}
}

// resolveEmailHubEndpoint checks one side (prefix "imap" or "smtp") in form
// order and returns its normalized host. Only an IP literal is judged against
// netguard here; a hostname is judged on the IP it resolves to at dial time.
func resolveEmailHubEndpoint(prefix, rawHost string, port int, security string) (string, error) {
	host, ok := normalizeEmailHubHost(rawHost)
	if !ok {
		return "", emailHubServerFieldError(ErrEmailHubInvalidServer, prefix+"_host")
	}
	if ip, err := netip.ParseAddr(host); err == nil && !netguard.AllowedIP(ip) {
		return "", emailHubServerFieldError(ErrEmailHubHostNotAllowed, prefix+"_host")
	}
	if !netguard.AllowedPort(port) {
		return "", emailHubServerFieldError(ErrEmailHubInvalidServer, prefix+"_port")
	}
	if security != "tls" && security != "starttls" {
		return "", emailHubServerFieldError(ErrEmailHubInvalidServer, prefix+"_security")
	}
	return host, nil
}

// normalizeEmailHubHost returns the one spelling of a host that is dialled,
// stored and compared, so a case or trailing-dot change is never a server
// change. It accepts a hostname (IDN becomes punycode) or an IP literal
// (IPv6 optionally in brackets); anything with a scheme, port, path or
// userinfo is refused.
func normalizeEmailHubHost(raw string) (string, bool) {
	h := strings.TrimSpace(raw)
	if strings.HasPrefix(h, "[") && strings.HasSuffix(h, "]") {
		ip, err := netip.ParseAddr(h[1 : len(h)-1])
		if err != nil || !ip.Is6() {
			return "", false
		}
		return ip.WithZone("").Unmap().String(), true
	}
	h = strings.TrimSuffix(h, ".")
	if ip, err := netip.ParseAddr(h); err == nil {
		return ip.WithZone("").Unmap().String(), true
	}
	h, err := idna.Lookup.ToASCII(strings.ToLower(h))
	if err != nil || h == "" || len(h) > 253 {
		return "", false
	}
	labels := strings.Split(h, ".")
	for _, l := range labels {
		if l == "" || len(l) > 63 || l[0] == '-' || l[len(l)-1] == '-' ||
			strings.Trim(l, "abcdefghijklmnopqrstuvwxyz0123456789-") != "" {
			return "", false
		}
	}
	// An all-digit last label is no TLD but an IPv4 shorthand (127.1,
	// 2130706433) that some resolvers would turn into an address.
	if strings.Trim(labels[len(labels)-1], "0123456789") == "" {
		return "", false
	}
	return h, true
}

// emailHubServerFieldError is the 400 the client shows next to field (an SDI
// JSON name). The message never names the host: it reaches the client and
// the log.
func emailHubServerFieldError(sentinel error, field string) error {
	code := "email_hub_invalid_server"
	if errors.Is(sentinel, ErrEmailHubHostNotAllowed) {
		code = "email_hub_host_not_allowed"
	}
	return CodedError{
		Code: code, Status: http.StatusBadRequest, Msg: sentinel.Error(),
		Fields: map[string]any{"field": field}, Err: sentinel,
	}
}
