export type CapabilityStatus = "available" | "unavailable";

export type WorkManagementCapability =
  | "tasks.core"
  | "tasks.projects"
  | "tasks.attachments"
  | "tasks.agent_runs"
  | "tasks.squads"
  | "tasks.vcs"
  | "tasks.local_workdir"
  | "desktop.host"
  | "mobile.host";

export interface CapabilityState {
  status: CapabilityStatus;
  reason_code: string;
  explanation_key: string;
}
