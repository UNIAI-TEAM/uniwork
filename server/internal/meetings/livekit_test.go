package meetings

import (
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

func TestMintToken(t *testing.T) {
	tok, err := MintToken("api-key", "api-secret-at-least-32-characters!!", "uniwork-room1", "user_1", "Hà", time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	parsed, err := jwt.Parse(tok, func(*jwt.Token) (any, error) {
		return []byte("api-secret-at-least-32-characters!!"), nil
	})
	if err != nil || !parsed.Valid {
		t.Fatal("token does not verify:", err)
	}
	claims := parsed.Claims.(jwt.MapClaims)
	if claims["sub"] != "user_1" {
		t.Fatalf("sub = %v", claims["sub"])
	}
	video, ok := claims["video"].(map[string]any)
	if !ok || video["room"] != "uniwork-room1" || video["roomJoin"] != true {
		t.Fatalf("video grant = %v", claims["video"])
	}
}
