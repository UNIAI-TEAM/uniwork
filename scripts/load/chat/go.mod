// Its own module so the load generator never adds to server/go.mod or to the
// server's coverage profile; it shares the server's websocket version.
module github.com/unicomhub/uniwork/scripts/load/chat

go 1.27.0

require github.com/gorilla/websocket v1.5.3
