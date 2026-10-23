export type UploadSessionTarget =
  | {
      kind: "workspace";
      workspaceId: string;
      parentId?: string | null;
      title?: string;
      visibility?: string | null;
    }
  | { kind: "version"; documentId: string }
  | { kind: "frame"; documentId: string; frameToken: string };

export function uploadTargetKey(target: UploadSessionTarget): string {
  switch (target.kind) {
    case "workspace":
      return target.parentId
        ? `workspace:${target.workspaceId}:${target.parentId}`
        : `workspace:${target.workspaceId}`;
    case "version":
      return `version:${target.documentId}`;
    case "frame":
      return `frame:${target.documentId}`;
  }
}
