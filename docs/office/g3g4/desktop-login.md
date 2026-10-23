# Office desktop login (G4-03a / G4-03b)

This slice implements the public-client login contract from
[`desktop-auth-contract.md`](desktop-auth-contract.md) through the point where
the main process hands a successful exchange to the production secure-store
and transport seams delivered by 03b. The fake server and in-memory store
remain test seams.

## Flow

1. The main process creates an RFC 7636 verifier with the host CSPRNG, derives
   an unpadded S256 challenge, and independently creates an opaque state and
   attempt id. The pending attempt is held in memory for ten minutes.
2. Main sends the allow-listed `GET /auth/desktop/start` contract request to
   the configured deployment and opens the returned authorization URL through
   the system-browser launcher. Login and MFA stay in the existing browser;
   the renderer never receives a password or token.
3. The custom-scheme callback is checked against the exact
   `uniwork-office://auth/callback` redirect, the live attempt, state, client,
   deployment, and deadline. Query keys must be single and limited to `code`
   and `state`. A valid attempt is claimed before exchange, so a callback can
   only be consumed once.
4. Main sends the code and verifier over the allow-listed
   `POST /auth/desktop/exchange` seam. The fake server models the 02a response
   shape and single-use code. On success, the credential-store port receives
   the token pair; the renderer receives only `{ status, accountId,
   deploymentId }` session metadata.
5. A restart creates a new in-memory attempt store. The old verifier is gone,
   so an old callback is rejected and the user starts login again. Cancelling
   clears the pending attempt and returns the signed-out metadata state.

The host transport is deliberately an endpoint-and-method allowlist. It is
bound to one configured client and deployment and cannot proxy an arbitrary
URL. Logs contain only an attempt id and a typed reject reason; code, state,
verifier, URLs, and token fields are never logged or sent through IPC.

## Callback reject table

| Reason | Rejected when | Layer |
| --- | --- | --- |
| `no_attempt` | No live pending attempt exists (including restart) | main/client |
| `verifier_missing` | A malformed/restored attempt has no verifier | main/client |
| `expired` | The ten-minute deadline has passed | main/client |
| `wrong_redirect` | Scheme/host/path differs byte-for-byte, or a fragment is present | main/client |
| `wrong_client` | Pending attempt is not bound to the configured public client | main/client |
| `wrong_deployment` | Pending attempt is not bound to the configured deployment | main/client |
| `duplicate_query` | Any query key occurs more than once | main/client |
| `unexpected_query` | A query key other than `code` or `state` is supplied | main/client |
| `missing_code` / `missing_state` | Required callback value is absent or empty | main/client |
| `wrong_state` | Callback state does not equal the live attempt state | main/client |
| exchange failure | Fake/real server rejects code, redirect, verifier, expiry, or replay | transport |

The callback validator returns only a typed reason on failure. It does not
include the rejected URL or any secret-shaped value in its result.
The manager prunes an expired in-memory attempt before invoking the validator,
so a callback that arrives after the deadline is reported as `no_attempt` at the
manager boundary; direct validator callers receive `expired` for a retained
stale record. Both paths reject before exchange.

## G4-03b: real credentials and transport

The 03b host uses Electron's built-in `safeStorage` seam. On Windows this is
DPAPI and on macOS it is the Keychain; no native package is added. The
encrypted payload is written below the channel/deployment/account namespace in
the channel's Electron `userData` directory. A temporary file is fsync'd,
chmod'd to owner-only access, and atomically renamed into place. A failed or
locked safe store returns a typed `locked`, `unavailable`, or `corrupt` state;
there is no plaintext file fallback. Draft keys remain a separate G4-04 store
and are not deleted by logout.

`createHttpAuthTransport(resolveDeploymentProfile())` is the only production
HTTP seam. It constructs only the TLS `/api/v1/auth/desktop/start`,
`/exchange`, `/refresh`, `/logout`, `/devices`, and device-revoke routes and
validates the deployment/client binding before every request. The renderer has
no URL proxy and never receives an Authorization header or token-shaped value.
Wire errors are reduced to typed codes (`device_revoked`, `refresh_reused`,
`unauthorized`, `rate_limited`, or `network`) without copying server messages
into logs or IPC errors.

The main manager restores metadata only after the secure store is available,
persists the replacement pair before reporting `signed-in`, and serializes
concurrent refresh calls per session. A refresh replay or device revocation
clears the credential pair and reports `login-required`; a locked store reports
`locked`. Logout revokes the device session server-side before clearing local
credentials and leaves the independent draft key untouched. Account or
deployment scope changes increment a generation, cancel pending callbacks,
clear query/plaintext hooks, and discard late responses.

The fake transport mirrors the same exchange/refresh/revoke wire and remains a
test-only seam. Device-code fallback remains disabled. Packaged Windows and
macOS login/secure-store evidence remains the Q-DESKTOP-SYSTEM stage; this
document records the implementation and automated contract tests, not a claim
that those OS runs were performed here.
