export interface DocumentTab<T> {
  readonly id: string;
  readonly title: string;
  readonly format: string;
  readonly data: T;
}

export interface DocumentTabState<T> {
  readonly tabs: readonly DocumentTab<T>[];
  readonly activeTabId: string | null;
}

export const DOCUMENT_TAB_LIMIT = 8;

/** Document identity deduplicates independently of its format or editor data. */
export function openDocumentTab<T>(state: DocumentTabState<T>, tab: DocumentTab<T>): { state: DocumentTabState<T>; outcome: "opened" | "focused" | "limit" } {
  if (state.tabs.some((entry) => entry.id === tab.id)) return { state: { ...state, activeTabId: tab.id }, outcome: "focused" };
  if (state.tabs.length >= DOCUMENT_TAB_LIMIT) return { state, outcome: "limit" };
  return { state: { tabs: [...state.tabs, tab], activeTabId: tab.id }, outcome: "opened" };
}

export function selectDocumentTab<T>(state: DocumentTabState<T>, id: string | null): DocumentTabState<T> {
  if (id !== null && !state.tabs.some((entry) => entry.id === id)) return state;
  return { ...state, activeTabId: id };
}

export function closeDocumentTab<T>(state: DocumentTabState<T>, id: string): DocumentTabState<T> {
  const index = state.tabs.findIndex((entry) => entry.id === id);
  if (index < 0) return state;
  const tabs = state.tabs.filter((entry) => entry.id !== id);
  const activeTabId = state.activeTabId === id ? (tabs[Math.min(index, tabs.length - 1)]?.id ?? null) : state.activeTabId;
  return { tabs, activeTabId };
}

export function cycleDocumentTab<T>(state: DocumentTabState<T>, direction: 1 | -1): DocumentTabState<T> {
  const ids = [null, ...state.tabs.map((tab) => tab.id)];
  const index = ids.indexOf(state.activeTabId);
  return { ...state, activeTabId: ids[(index + direction + ids.length) % ids.length] ?? null };
}
