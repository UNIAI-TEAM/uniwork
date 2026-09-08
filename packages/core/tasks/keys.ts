/**
 * Query-key factories for Work Management. Every workspace-scoped key
 * includes `wsId` so invalidate waves stay tenant-local.
 *
 * Filter-sensitive lists use a 2-segment root for invalidate (TanStack prefix
 * match) and a 3-segment live key that appends a stable hash of the request.
 */
export const taskKeys = {
  list: (wsId: string) => ["tasks", wsId] as const,
  detail: (taskId: string) => ["task", taskId] as const,
  comments: (taskId: string) => ["comments", taskId] as const,
  queryRoot: (wsId: string) => ["tasks-query", wsId] as const,
  query: (wsId: string, filterHash: string) => ["tasks-query", wsId, filterHash] as const,
  groupedRoot: (wsId: string) => ["tasks-grouped", wsId] as const,
  grouped: (wsId: string, filterHash: string) => ["tasks-grouped", wsId, filterHash] as const,
  /** 2-segment root — invalidate all my-tasks variants for the workspace. */
  myTasks: (wsId: string) => ["my-tasks", wsId] as const,
  myTasksFiltered: (wsId: string, filterHash: string) => ["my-tasks", wsId, filterHash] as const,
  children: (taskId: string) => ["task-children", taskId] as const,
  childrenByParents: (wsId: string, parentHash: string) =>
    ["task-children-by-parents", wsId, parentHash] as const,
  childProgress: (wsId: string) => ["task-child-progress", wsId] as const,
  tableRoot: (wsId: string) => ["tasks-table", wsId] as const,
  tableGroups: (wsId: string, filterHash: string) => ["tasks-table", wsId, "groups", filterHash] as const,
  tableRows: (wsId: string, filterHash: string) => ["tasks-table", wsId, "rows", filterHash] as const,
  tableFacets: (wsId: string, filterHash: string) => ["tasks-table", wsId, "facets", filterHash] as const,
  statuses: (wsId: string) => ["task-statuses", wsId] as const,
  labels: (wsId: string) => ["task-labels", wsId] as const,
  label: (wsId: string, labelId: string) => ["task-label", wsId, labelId] as const,
  properties: (wsId: string) => ["task-properties", wsId] as const,
  taskLabels: (taskId: string) => ["task-labels-on-task", taskId] as const,
  /** 2-segment root for invalidate; live queries append scopeHash. */
  views: (wsId: string) => ["task-views", wsId] as const,
  viewsScoped: (wsId: string, scopeHash: string) => ["task-views", wsId, scopeHash] as const,
  view: (wsId: string, viewId: string) => ["task-view", wsId, viewId] as const,
  /** 2-segment root for invalidate; live queries append scopeHash. */
  viewPrefs: (wsId: string) => ["task-view-prefs", wsId] as const,
  viewPrefsScoped: (wsId: string, scopeHash: string) =>
    ["task-view-prefs", wsId, scopeHash] as const,
  pins: (wsId: string) => ["task-pins", wsId] as const,
  projects: (wsId: string) => ["projects", wsId] as const,
  projectSearch: (wsId: string, filterHash: string) => ["projects-search", wsId, filterHash] as const,
  project: (wsId: string, projectId: string) => ["project", wsId, projectId] as const,
  projectResources: (wsId: string, projectId: string) =>
    ["project-resources", wsId, projectId] as const,
  subscribers: (taskId: string) => ["task-subscribers", taskId] as const,
};
