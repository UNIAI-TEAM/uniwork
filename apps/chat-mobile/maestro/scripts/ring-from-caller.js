// Rings the signed-in test account from a second account through the API,
// as the caller's own app would: POST …/voice/invite with a fresh call id.
// Inputs (maestro -e): MAESTRO_API_URL, MAESTRO_CALLER_TOKEN (an access token
// of the second account), MAESTRO_CALLER_WS_ID, MAESTRO_DM_ROOM_ID (their DM
// with the test account). Leaves output.callId for the hang-up step.
const callId = "maestro-" + Date.now();
const response = http.post(`${MAESTRO_API_URL}/api/v1/workspaces/${MAESTRO_CALLER_WS_ID}/chat/rooms/${MAESTRO_DM_ROOM_ID}/voice/invite`, {
  headers: { Authorization: `Bearer ${MAESTRO_CALLER_TOKEN}`, "Content-Type": "application/json" },
  body: JSON.stringify({ call_id: callId }),
});
if (response.status >= 300) throw new Error(`invite failed: ${response.status}`);
output.callId = callId;
