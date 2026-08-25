"use client";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { getAccessToken } from "../api/session";
import { WorkspaceEventSchema } from "../types";

export function useWorkspaceEvents(workspaceId: string) {
  const qc = useQueryClient();

  useEffect(() => {
    if (!workspaceId) return;
    let ws: WebSocket | null = null;
    let closed = false;
    let retry: ReturnType<typeof setTimeout> | undefined;

    const connect = () => {
      const token = getAccessToken();
      if (!token) return;
      const base = process.env.NEXT_PUBLIC_WS_URL ?? "ws://localhost:8080";
      ws = new WebSocket(`${base}/api/v1/ws?workspace=${workspaceId}&token=${token}`);
      ws.onmessage = (msg) => {
        const parsed = WorkspaceEventSchema.safeParse(JSON.parse(String(msg.data)));
        if (!parsed.success) return;
        const { type, payload } = parsed.data;
        if (type.startsWith("task.") || type.startsWith("comment.")) {
          void qc.invalidateQueries({ queryKey: ["tasks", workspaceId] });
          const taskId = payload?.task_id;
          if (taskId) {
            void qc.invalidateQueries({ queryKey: ["task", taskId] });
            void qc.invalidateQueries({ queryKey: ["comments", taskId] });
          }
        }
        if (type.startsWith("meeting.")) {
          void qc.invalidateQueries({ queryKey: ["meetings", workspaceId] });
        }
      };
      ws.onclose = () => {
        if (!closed) retry = setTimeout(connect, 3000);
      };
    };
    connect();
    return () => {
      closed = true;
      clearTimeout(retry);
      ws?.close();
    };
  }, [workspaceId, qc]);
}
