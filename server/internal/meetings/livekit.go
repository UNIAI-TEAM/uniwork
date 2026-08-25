// Package meetings mints LiveKit access tokens server-side so the
// LiveKit API secret never reaches the frontend.
package meetings

import (
	"time"

	"github.com/livekit/protocol/auth"
)

func MintToken(apiKey, apiSecret, room, identity, name string, ttl time.Duration) (string, error) {
	at := auth.NewAccessToken(apiKey, apiSecret)
	grant := &auth.VideoGrant{RoomJoin: true, Room: room}
	at.SetVideoGrant(grant).SetIdentity(identity).SetName(name).SetValidFor(ttl)
	return at.ToJWT()
}
