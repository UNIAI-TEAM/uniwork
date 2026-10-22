export function loadConfig(env, readFile, path = "scripts/uniai-sync/config.json") {
  const file = JSON.parse(readFile(path));
  return {
    uniaiProjectId: file.uniai_project_id,
    origin: String(file.uniwork_origin).replace(/\/$/, ""),
    workspaceId: file.uniwork_workspace_id,
    projectId: file.uniwork_project_id,
    mcpToken: env.UNIWORK_MCP_TOKEN ?? "",
    sessionToken: env.UNIWORK_SESSION_TOKEN ?? "",
  };
}
