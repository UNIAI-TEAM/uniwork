import type { MatrixSession } from "../types/user";
import { MatrixSessionSchema } from "../types/user";

/** Build a Matrix user id for a UniWork member in the same homeserver. */
export function matrixUserIdForMember(memberUserId: string, session: MatrixSession): string {
  const localpart = memberUserId.toLowerCase();
  const server = homeserverFromSession(session);
  return `@${localpart}:${server}`;
}

export function homeserverFromSession(session: MatrixSession): string {
  if (session.home_server) return session.home_server;
  const match = session.user_id.match(/^@[^:]+:(.+)$/);
  return match?.[1] ?? "localhost";
}

export function matrixLocalpart(matrixUserId: string): string {
  if (matrixUserId.startsWith("@")) {
    const colon = matrixUserId.indexOf(":");
    if (colon > 1) return matrixUserId.slice(1, colon).toLowerCase();
  }
  return matrixUserId.toLowerCase();
}

export function displayNameForMatrixSender(
  sender: string,
  members: Array<{ user_id: string; display_name: string; matrix_user_id?: string | null }>,
  selfUserId?: string,
  selfLabel?: string,
): string {
  const local = matrixLocalpart(sender);
  if (selfUserId && local === selfUserId.toLowerCase() && selfLabel) {
    return selfLabel;
  }
  const member = members.find(
    (m) =>
      m.user_id.toLowerCase() === local ||
      (m.matrix_user_id != null && m.matrix_user_id.toLowerCase() === sender.toLowerCase()),
  );
  return member?.display_name ?? local;
}

export function parseStoredMatrixSession(raw: string | null): MatrixSession | null {
  if (!raw) return null;
  try {
    return MatrixSessionSchema.parse(JSON.parse(raw));
  } catch {
    return null;
  }
}
