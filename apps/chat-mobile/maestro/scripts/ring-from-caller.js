// Rings the signed-in test account from a second account through the API,
// as the caller's own app would: POST …/voice/invite with a fresh call id.
// Inputs (maestro -e): MAESTRO_API_URL, MAESTRO_CALLER_WS_ID,
// MAESTRO_DM_ROOM_ID (the second account's DM with the test account), and
// output.peerToken from peer-session.js, which the flow runs first. Leaves
// output.callId for the hang-up step.
if (!output.peerToken) throw new Error("run ../scripts/peer-session.js first");
const callId = "maestro-" + Date.now();
const response = http.post(`${MAESTRO_API_URL}/api/v1/workspaces/${MAESTRO_CALLER_WS_ID}/chat/rooms/${MAESTRO_DM_ROOM_ID}/voice/invite`, {
  headers: { Authorization: `Bearer ${output.peerToken}`, "Content-Type": "application/json" },
  body: JSON.stringify({ call_id: callId }),
});
if (response.status >= 300) throw new Error(`invite failed: ${response.status}`);
output.callId = callId;
