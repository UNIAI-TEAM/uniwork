/**
 * Query-key factories for Work Management. Every workspace-scoped key
 * includes `wsId` so invalidate waves stay tenant-local.
 */
export const taskKeys = {
  list: (wsId: string) => ["tasks", wsId] as const,
  detail: (taskId: string) => ["task", taskId] as const,
  comments: (taskId: string) => ["comments", taskId] as const,
  queryRoot: (wsId: string) => ["tasks-query", wsId] as const,
  query: (wsId: string, filterHash: string) => ["tasks-query", wsId, filterHash] as const,
  grouped: (wsId: string, groupBy: string) => ["tasks-grouped", wsId, groupBy] as const,
  myTasks: (wsId: string) => ["my-tasks", wsId] as const,
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
  views: (wsId: string, scopeHash = "") => ["task-views", wsId, scopeHash] as const,
  view: (wsId: string, viewId: string) => ["task-view", wsId, viewId] as const,
  viewPrefs: (wsId: string, scopeHash: string) => ["task-view-prefs", wsId, scopeHash] as const,
  pins: (wsId: string) => ["task-pins", wsId] as const,
  projects: (wsId: string) => ["projects", wsId] as const,
  projectSearch: (wsId: string, q: string) => ["projects-search", wsId, q] as const,
  project: (wsId: string, projectId: string) => ["project", wsId, projectId] as const,
  projectResources: (wsId: string, projectId: string) =>
    ["project-resources", wsId, projectId] as const,
  subscribers: (taskId: string) => ["task-subscribers", taskId] as const,
};
