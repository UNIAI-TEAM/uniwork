// G3-09b sample: call this only from the explicit "Chỉnh sửa trên UniWork
// Office" click handler. The ticket is never placed in analytics, logs or
// renderer state; the browser hands the URL to the OS and forgets it.
export async function requestOfficeLaunch({ apiOrigin, documentId, operation = "edit", version, deploymentId, clientId, fetchImpl = fetch }) {
  const body = { operation, deployment_id: deploymentId, client_id: clientId };
  if (version !== undefined) body.version = version;
  const response = await fetchImpl(`${apiOrigin.replace(/\/$/, "")}/api/v1/documents/${encodeURIComponent(documentId)}/office/sessions`, {
    method: "POST",
    cache: "no-store",
    credentials: "include",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error("Office launch request failed");
  const result = await response.json();
  if (typeof result.launch_url !== "string" || typeof result.launch_ticket !== "string" || typeof result.expires_at !== "string") throw new Error("Malformed Office launch response");
  // The launch URL has exactly one query key (`ticket`) and no document
  // metadata. Do not retry after a timeout: request a new ticket instead.
  const parsed = new URL(result.launch_url);
  if (parsed.protocol !== "uniwork-office:" || parsed.hostname !== "open" || [...parsed.searchParams.keys()].length !== 1 || !parsed.searchParams.has("ticket")) throw new Error("Invalid Office launch URL");
  window.location.assign(result.launch_url);
  return { expiresAt: result.expires_at, documentId: result.document_id, operation: result.operation, version: result.version };
}

