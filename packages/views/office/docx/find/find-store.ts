/**
 * Find panel visibility, shared by the toolbar group that toggles it and the
 * chrome slot the shell mounts next to the document (two different subtrees, so
 * no common ancestor can hold the state). Module singleton like the view zoom
 * controller: one DOCX editing surface per host page.
 */
let open = false;
const listeners = new Set<() => void>();

function setOpen(next: boolean): void {
  if (next === open) return;
  open = next;
  for (const listener of listeners) listener();
}

export function isDocxFindOpen(): boolean {
  return open;
}

export function subscribeDocxFind(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function closeDocxFind(): void {
  setOpen(false);
}

/** The open/find command; A9's shortcut map (Ctrl+F) binds this. */
export function toggleDocxFind(): void {
  setOpen(!open);
}
