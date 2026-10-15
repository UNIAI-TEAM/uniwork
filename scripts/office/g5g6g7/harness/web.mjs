// G8-19 (UNI-1414) web driver: one Playwright context per user on the D web.
// Contract: g8-contract.md §6.

/**
 * The D document URL the web Inbox builds (packages/views/notifications/resource-href.ts:33-42):
 * `/{org}/{ws}/documents/{id}`, plus `?comment=<id>` and `&kind=discussion` for a discussion.
 */
export function documentUrl({ webOrigin, org, ws, documentId, comment = null, kind = null }) {
  for (const [name, value] of Object.entries({ webOrigin, org, ws, documentId })) {
    if (typeof value !== "string" || value === "") throw new Error(`documentUrl: ${name} is required`);
  }
  const url = new URL(`/${encodeURIComponent(org)}/${encodeURIComponent(ws)}/documents/${encodeURIComponent(documentId)}`, webOrigin);
  if (comment) url.searchParams.set("comment", comment);
  if (comment && kind === "discussion") url.searchParams.set("kind", "discussion");
  return url.toString();
}

/** STEP 1 stub: the signature is final (contract §6), the body lands with T1 STEP 2. */
export async function webLogin(_browser, _user, _opts) {
  throw new Error("webLogin: not implemented yet (UNI-1414 T1 step 2)");
}

/** STEP 1 stub: the signature is final (contract §6), the body lands with T1 STEP 2. */
export async function openDocument(_page, _opts) {
  throw new Error("openDocument: not implemented yet (UNI-1414 T1 step 2)");
}
