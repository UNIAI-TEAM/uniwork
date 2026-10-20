// Command dispatch is the S0 spike's server side (UNI-2022): what ensureScribe
// would send. It calls CreateDispatch for one room with the D6-shaped metadata
// and prints the dispatches the room holds. Throwaway reference code.
package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"os"
	"time"

	"github.com/livekit/protocol/livekit"
	lksdk "github.com/livekit/server-sdk-go/v2"
)

func main() {
	meetingID := flag.String("meeting", "", "meeting id; the room is uw_mtg_<id>")
	rawMeta := flag.String("metadata", "", "override metadata (to prove the agent rejects bad jobs)")
	agent := flag.String("agent", "uniwork-scribe", "agent_name")
	flag.Parse()
	if *meetingID == "" {
		log.Fatal("-meeting is required")
	}
	room := "uw_mtg_" + *meetingID
	meta := *rawMeta
	if meta == "" {
		// S1 replaces "token" with the signed per-meeting token (D6).
		b, _ := json.Marshal(map[string]string{"meeting_id": *meetingID, "token": "spike-token", "locale": "vi"})
		meta = string(b)
	}

	// The SDK takes the ws(s) URL and switches to http(s) for Twirp itself.
	c := lksdk.NewAgentDispatchServiceClient(os.Getenv("LIVEKIT_URL"), os.Getenv("LIVEKIT_API_KEY"), os.Getenv("LIVEKIT_API_SECRET"))
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	start := time.Now()
	d, err := c.CreateDispatch(ctx, &livekit.CreateAgentDispatchRequest{AgentName: *agent, Room: room, Metadata: meta})
	if err != nil {
		log.Fatalf("CreateDispatch: %v", err)
	}
	fmt.Printf("created dispatch id=%s agent=%s room=%s in %s\n", d.Id, d.AgentName, d.Room, time.Since(start).Round(time.Millisecond))

	list, err := c.ListDispatch(ctx, &livekit.ListAgentDispatchRequest{Room: room})
	if err != nil {
		log.Fatalf("ListDispatch: %v", err)
	}
	for _, x := range list.AgentDispatches {
		fmt.Printf("room %s holds dispatch id=%s agent=%s metadata_bytes=%d\n", room, x.Id, x.AgentName, len(x.Metadata))
	}
}
