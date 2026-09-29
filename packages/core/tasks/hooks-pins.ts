"use client";
import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import * as views from "../api/endpoints/task-views";
import type { TaskPin } from "../types/task-view";
import { taskKeys } from "./keys";

type PinSnapshot = { prev: views.TaskPinList | undefined };

/** Stops any in-flight list fetch, then swaps the cached pins for `next(pins)`. */
async function writePins(
  qc: QueryClient,
  workspaceId: string,
  next: (pins: TaskPin[]) => TaskPin[],
): Promise<PinSnapshot> {
  const key = taskKeys.pins(workspaceId);
  await qc.cancelQueries({ queryKey: key });
  const prev = qc.getQueryData<views.TaskPinList>(key);
  const pins = next(prev?.pins ?? []);
  qc.setQueryData<views.TaskPinList>(key, { pins, total: pins.length });
  return { prev };
}

function restorePins(qc: QueryClient, workspaceId: string, ctx: PinSnapshot | undefined) {
  if (ctx) qc.setQueryData(taskKeys.pins(workspaceId), ctx.prev);
}

const sameItem = (p: TaskPin, itemType: string, itemId: string) =>
  p.item_type === itemType && p.item_id === itemId;

export function usePins(workspaceId: string, opts: { include?: string } = {}) {
  return useQuery({
    queryKey: taskKeys.pins(workspaceId),
    queryFn: () => views.listPins(workspaceId, opts),
    enabled: !!workspaceId,
  });
}

export function useCreatePin(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: views.CreatePinBody) => views.createPin(workspaceId, body),
    onMutate: (body) =>
      writePins(qc, workspaceId, (pins) => {
        if (pins.some((p) => sameItem(p, body.item_type, body.item_id))) return pins;
        const now = new Date().toISOString();
        // Stands in until the server answers with the real id and position.
        const placeholder: TaskPin = {
          id: `pending:${body.item_type}:${body.item_id}`,
          organization_id: "",
          workspace_id: workspaceId,
          user_id: "",
          item_type: body.item_type,
          item_id: body.item_id,
          position: Math.max(0, ...pins.map((p) => p.position)) + 1,
          created_at: now,
          updated_at: now,
        };
        return [...pins, placeholder];
      }),
    onSuccess: (saved, body) => {
      if (!saved) return;
      qc.setQueryData<views.TaskPinList>(taskKeys.pins(workspaceId), (old) => {
        const pins = (old?.pins ?? []).map((p) => (sameItem(p, body.item_type, body.item_id) ? saved : p));
        return { pins, total: pins.length };
      });
    },
    onError: (_err, _body, ctx) => restorePins(qc, workspaceId, ctx),
    onSettled: () => void qc.invalidateQueries({ queryKey: taskKeys.pins(workspaceId) }),
  });
}

export function useDeletePin(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ itemType, itemId }: { itemType: string; itemId: string }) =>
      views.deletePin(workspaceId, itemType, itemId),
    onMutate: ({ itemType, itemId }) =>
      writePins(qc, workspaceId, (pins) => pins.filter((p) => !sameItem(p, itemType, itemId))),
    onError: (_err, _vars, ctx) => restorePins(qc, workspaceId, ctx),
    onSettled: () => void qc.invalidateQueries({ queryKey: taskKeys.pins(workspaceId) }),
  });
}

/** Takes the pins in their new order; positions are sent as 1…n. */
export function useReorderPins(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ordered: TaskPin[]) =>
      views.reorderPins(
        workspaceId,
        ordered.map((p, i) => ({ id: p.id, position: i + 1 })),
      ),
    onMutate: (ordered) =>
      writePins(qc, workspaceId, () => ordered.map((p, i) => ({ ...p, position: i + 1 }))),
    onError: (_err, _vars, ctx) => restorePins(qc, workspaceId, ctx),
  });
}
