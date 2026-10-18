// Who a user id is, for message senders, typing lines and the mention list.
//   senderLabelFor     ← packages/views/chat/native-chat-message-mapping.ts
//   buildChatNameContext ← packages/views/chat/chat-page-utils.ts (contacts, room
//                        members, workspace members; a nickname wins, first entry wins)
// people-display.test.ts runs the web cases of senderLabelFor.
import { displayLabelForChatContact, resolveChatNicknameForUser, type ChatContact } from "./rooms-display";

export interface NameContextEntry {
  user_id: string;
  display_name: string;
  email?: string;
}

type Person = { user_id: string; display_name: string; email: string };

function sameId(left: string, right: string): boolean {
  return left.trim().toUpperCase() === right.trim().toUpperCase();
}

export function buildChatNameContext(
  contacts: readonly ChatContact[],
  roomMembers: readonly Person[],
  workspaceMembers: readonly Person[],
  nicknamesByUserId: Readonly<Record<string, string>>,
): NameContextEntry[] {
  const out: NameContextEntry[] = [];
  const seen = new Set<string>();
  const push = (userId: string, name: string, email: string) => {
    const key = userId.trim().toUpperCase();
    if (!key || seen.has(key)) return;
    seen.add(key);
    out.push({ user_id: userId, display_name: name, email });
  };
  for (const contact of contacts) push(contact.user_id, displayLabelForChatContact(contact, nicknamesByUserId), contact.email);
  for (const person of [...roomMembers, ...workspaceMembers]) {
    push(person.user_id, resolveChatNicknameForUser(nicknamesByUserId, person.user_id) || person.display_name, person.email);
  }
  return out;
}

export function senderLabelFor(
  message: { sender: string },
  currentUserId: string,
  youLabel: string,
  nameContext: readonly NameContextEntry[],
): string {
  if (sameId(message.sender, currentUserId)) return youLabel;
  const match = nameContext.find((entry) => sameId(entry.user_id, message.sender));
  const name = match?.display_name?.trim() ?? "";
  if (name && !sameId(name, message.sender)) return name;
  const local = match?.email?.split("@")[0]?.trim() ?? "";
  if (local && !sameId(local, message.sender)) return local;
  return name || message.sender;
}
