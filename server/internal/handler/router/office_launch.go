package router

import (
	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdi"
	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdo"
)

// registerOfficeLaunch contains the desktop-main exchange and explicit revoke
// endpoints. Creation remains beside the document routes so the document flag
// and its ACL gate apply before a ticket can be minted.
func registerOfficeLaunch(r api, h Routes) {
	r.Post("/office/sessions/exchange", h.ExchangeOfficeLaunch, apiOp{
		summary:     "Redeem an Office launch ticket",
		description: "Desktop main only: atomically consume the opaque ticket after rechecking device, account, deployment and Document ACL. The response is metadata plus a first-party download route; it never contains bytes or storage URLs.",
		tags:        []string{"documents"}, sdi: sdi.ExchangeOfficeLaunchSessionSDI{}, sdo: sdo.OfficeLaunchExchangeSDO{}, auth: true,
	})
	r.Delete("/office/sessions/{launchSessionID}", h.RevokeOfficeLaunch, apiOp{
		summary:     "Revoke an Office launch ticket",
		description: "Cancel an unredeemed launch ticket owned by the current account. Repeated cancellation is idempotent and never returns the ticket.",
		tags:        []string{"documents"}, sdo: sdo.StatusSDO{}, auth: true,
	})
}
