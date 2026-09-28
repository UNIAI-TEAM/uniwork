"use client";
import { useParams } from "next/navigation";
import { PublicDocumentView } from "@uniwork/views/documents";

/**
 * `/share/{token}` — the anonymous public document (G1-08). Deliberately
 * outside the workspace shell and every guard: the link token is the whole
 * credential, and the view renders only what the token-scoped API answers.
 */
export default function Page() {
  const { token } = useParams<{ token: string }>();
  return <PublicDocumentView token={token} />;
}
