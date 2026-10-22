// Signs in as the second account, as its own app would (POST /api/v1/auth/login), and leaves its access token in
// output.peerToken for post-as-peer.js and ring-from-caller.js. Inputs: MAESTRO_API_URL, MAESTRO_CALLER_EMAIL,
// MAESTRO_CALLER_PASSWORD. Signed in afresh by each flow that needs it: an access token lives fifteen minutes, so one
// kept in a repository secret, or minted when the PR job seeded its server, is dead by the flow that would use it.
const response = http.post(`${MAESTRO_API_URL}/api/v1/auth/login`, {
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email: MAESTRO_CALLER_EMAIL, password: MAESTRO_CALLER_PASSWORD }),
});
if (response.status >= 300) throw new Error(`peer sign-in failed: ${response.status}`);
output.peerToken = json(response.body).access_token;
if (!output.peerToken) throw new Error("peer sign-in returned no access token");
