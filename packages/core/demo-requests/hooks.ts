"use client";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as api from "../api/endpoints/demo-requests";
export { DEMO_TEAM_SIZES } from "../api/endpoints/demo-requests";
export type { DemoRequest, DemoRequestInput, DemoStatus } from "../api/endpoints/demo-requests";
const demoRequestKeys = { root: ["admin", "demo-requests"] as const, list: (query: api.DemoRequestQuery) => ["admin", "demo-requests", query] as const };
export function useCreateDemoRequest() {
  return useMutation({ mutationFn: ({ input, key }: { input: api.DemoRequestInput; key: string }) => api.createDemoRequest(input, key) });
}
export function useDemoRequests(query: api.DemoRequestQuery) {
  return useQuery({ queryKey: demoRequestKeys.list(query), queryFn: () => api.listDemoRequests(query), placeholderData: keepPreviousData });
}
export function useUpdateDemoRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, status, reason }: { id: string; status: api.DemoStatus; reason: string }) => {
      const row = await api.updateDemoRequest(id, { status, reason });
      if (!row) throw new Error("The demo request update returned no receipt");
      return row;
    },
    onSuccess: () => { void qc.invalidateQueries({ queryKey: demoRequestKeys.root }); },
  });
}
