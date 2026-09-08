"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as projects from "../api/endpoints/projects";
import { taskKeys } from "./keys";

export function useProjects(
  workspaceId: string,
  opts: { status?: string; priority?: string } = {},
) {
  return useQuery({
    queryKey: [...taskKeys.projects(workspaceId), opts] as const,
    queryFn: () => projects.listProjects(workspaceId, opts),
    enabled: !!workspaceId,
  });
}

export function useSearchProjects(
  workspaceId: string,
  opts: { q?: string; include_closed?: boolean; limit?: number; offset?: number },
) {
  return useQuery({
    queryKey: taskKeys.projectSearch(workspaceId, opts.q ?? ""),
    queryFn: () => projects.searchProjects(workspaceId, opts),
    enabled: !!workspaceId && !!opts.q,
  });
}

export function useProject(workspaceId: string, projectId: string) {
  return useQuery({
    queryKey: taskKeys.project(workspaceId, projectId),
    queryFn: () => projects.getProject(workspaceId, projectId),
    enabled: !!workspaceId && !!projectId,
  });
}

export function useCreateProject(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: projects.CreateProjectBody) => projects.createProject(workspaceId, body),
    onSuccess: () => void qc.invalidateQueries({ queryKey: taskKeys.projects(workspaceId) }),
  });
}

export function usePutProject(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      projectId,
      body,
      ifMatch,
    }: {
      projectId: string;
      body: projects.PutProjectBody;
      ifMatch?: string;
    }) => projects.putProject(workspaceId, projectId, body, { ifMatch }),
    onSuccess: (_d, { projectId }) => {
      void qc.invalidateQueries({ queryKey: taskKeys.projects(workspaceId) });
      void qc.invalidateQueries({ queryKey: taskKeys.project(workspaceId, projectId) });
    },
  });
}

export function useDeleteProject(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (projectId: string) => projects.deleteProject(workspaceId, projectId),
    onSuccess: () => void qc.invalidateQueries({ queryKey: taskKeys.projects(workspaceId) }),
  });
}

export function useProjectResources(workspaceId: string, projectId: string) {
  return useQuery({
    queryKey: taskKeys.projectResources(workspaceId, projectId),
    queryFn: () => projects.listProjectResources(workspaceId, projectId),
    enabled: !!workspaceId && !!projectId,
  });
}

export function useCreateProjectResource(workspaceId: string, projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: projects.CreateProjectResourceBody) =>
      projects.createProjectResource(workspaceId, projectId, body),
    onSuccess: () => {
      void qc.invalidateQueries({
        queryKey: taskKeys.projectResources(workspaceId, projectId),
      });
      void qc.invalidateQueries({ queryKey: taskKeys.project(workspaceId, projectId) });
    },
  });
}
