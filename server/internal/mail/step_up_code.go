package mail

import (
	"fmt"
	"time"
)

// The commands a step-up code is mailed for (ADR 0049 §5, spec §3.7). The
// mail names the one the code unlocks, so an owner who did not ask knows
// what someone holding their session tried, and the code proves only that.
const (
	StepUpActionSetPassword       = "set_password"
	StepUpActionChangePassword    = "change_password"
	StepUpActionLinkGoogle        = "link_google"
	StepUpActionLinkApple         = "link_apple"
	StepUpActionUnlinkGoogle      = "unlink_google"
	StepUpActionUnlinkApple       = "unlink_apple"
	StepUpActionEnableMFA         = "enable_mfa"
	StepUpActionDeleteAccount     = "delete_account"
	StepUpActionTransferOwnership = "transfer_ownership"
)

// stepUpActionNames is each action as the mail says it, Vietnamese then
// English, written to follow "to" / "để".
var stepUpActionNames = map[string][2]string{
	StepUpActionSetPassword:       {"đặt mật khẩu", "set a password"},
	StepUpActionChangePassword:    {"đổi mật khẩu", "change your password"},
	StepUpActionLinkGoogle:        {"liên kết Google", "link Google"},
	StepUpActionLinkApple:         {"liên kết Apple", "link Apple"},
	StepUpActionUnlinkGoogle:      {"gỡ liên kết Google", "unlink Google"},
	StepUpActionUnlinkApple:       {"gỡ liên kết Apple", "unlink Apple"},
	StepUpActionEnableMFA:         {"bật xác thực hai lớp", "turn on two-step verification"},
	StepUpActionDeleteAccount:     {"xóa tài khoản", "delete your account"},
	StepUpActionTransferOwnership: {"chuyển quyền sở hữu tổ chức", "transfer ownership of your organization"},
}

// IsStepUpAction reports whether a step-up code can be mailed for action.
func IsStepUpAction(action string) bool {
	_, ok := stepUpActionNames[action]
	return ok
}

type StepUpCodeData struct {
	Code    string
	Expires time.Duration
	// Action is one of the StepUpAction* constants.
	Action string
	// Device and IP name where the request came from; the caller passes them
	// through SafeField and the template escapes them again. Either may be
	// empty.
	Device string
	IP     string
	At     time.Time
}

// stepUpCodeView adds the action's words and the security page link, built
// here so no caller can point it elsewhere.
type stepUpCodeView struct {
	StepUpCodeData
	ActionName  string
	SecurityURL string
}

// StepUpCode mails the six-digit code that proves, from a session already
// signed in, that the account's owner is at the keyboard for one action. The
// expiry is the one the service enforces.
func (r Renderer) StepUpCode(to, locale, userID string, d StepUpCodeData) (Message, error) {
	names, ok := stepUpActionNames[d.Action]
	if !ok {
		return Message{}, fmt.Errorf("mail: unknown step-up action %q", d.Action)
	}
	locale = normalizeLocale(locale)
	name := names[1]
	if locale == "vi" {
		name = names[0]
	}
	view := stepUpCodeView{StepUpCodeData: d, ActionName: name, SecurityURL: r.AppURL + "/settings?tab=security"}
	subject, html, text, err := renderKind(KindStepUpCode, locale, r.AppURL, view)
	if err != nil {
		return Message{}, err
	}
	return Message{Kind: KindStepUpCode, Locale: locale, UserID: userID, To: to, Subject: subject, HTML: html, Text: text}, nil
}
