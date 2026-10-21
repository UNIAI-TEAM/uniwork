// Posts a message into the test account's DM as the second account, as its
// own app would: POST …/messages with a fresh client_msg_id. Inputs (maestro
// -e): MAESTRO_API_URL, MAESTRO_CALLER_TOKEN (an access token of the second
// account), MAESTRO_CALLER_WS_ID, MAESTRO_DM_ROOM_ID (their DM with the test
// account). Leaves output.peerBody for the flow to look for.
const body = "Peer " + Date.now();
const response = http.post(`${MAESTRO_API_URL}/api/v1/workspaces/${MAESTRO_CALLER_WS_ID}/chat/rooms/${MAESTRO_DM_ROOM_ID}/messages`, {
  headers: { Authorization: `Bearer ${MAESTRO_CALLER_TOKEN}`, "Content-Type": "application/json" },
  body: JSON.stringify({ body, client_msg_id: "maestro-" + Date.now() }),
});
if (response.status >= 300) throw new Error(`post failed: ${response.status}`);
output.peerBody = body;
