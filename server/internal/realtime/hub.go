// Package realtime fans out workspace-scoped events to connected
// WebSocket clients. Scaled-down version of usf's internal/realtime:
// one room per workspace, drop-on-full delivery, Redis pub/sub bridge
// for multi-instance fanout.
package realtime

import "sync"

type Hub struct {
	mu    sync.RWMutex
	rooms map[string]map[*Client]struct{}
}

func NewHub() *Hub {
	return &Hub{rooms: map[string]map[*Client]struct{}{}}
}

func (h *Hub) Add(workspaceID string, c *Client) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.rooms[workspaceID] == nil {
		h.rooms[workspaceID] = map[*Client]struct{}{}
	}
	h.rooms[workspaceID][c] = struct{}{}
}

func (h *Hub) Remove(workspaceID string, c *Client) {
	h.mu.Lock()
	defer h.mu.Unlock()
	delete(h.rooms[workspaceID], c)
	if len(h.rooms[workspaceID]) == 0 {
		delete(h.rooms, workspaceID)
	}
}

func (h *Hub) Broadcast(workspaceID string, msg []byte) {
	h.mu.RLock()
	defer h.mu.RUnlock()
	for c := range h.rooms[workspaceID] {
		select {
		case c.send <- msg:
		default: // client chậm: drop message thay vì block cả hub
		}
	}
}
