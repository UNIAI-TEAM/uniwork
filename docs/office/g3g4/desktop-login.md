# Office desktop login (G4-03a)

This slice implements the public-client login contract from
[`desktop-auth-contract.md`](desktop-auth-contract.md) through the point where
the main process hands a successful exchange to a `CredentialStore` port. The
fake server and in-memory store are test seams; no production auth endpoint or
OS keychain is claimed by this document.

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

## 03b open items

* Select and document the Windows DPAPI / macOS Keychain library for the
  `CredentialStore` port under G4-D2. Replace the in-memory fake only after the
  library, ACL/namespace, and crash-recovery behavior are approved.
* Add the real TLS HTTP client and endpoint configuration for G4-02b. Keep the
  same path/method allowlist, exact redirect binding, code TTL, and typed error
  behavior.
* Add refresh single-flight, atomic token persistence, logout/device revoke,
  account/deployment switch generation and query-cache clearing.
* Run login/system-browser and OS secure-store evidence on packaged Windows
  and macOS builds (Q-DESKTOP-SYSTEM). This 03a unit slice does not claim that
  evidence.
