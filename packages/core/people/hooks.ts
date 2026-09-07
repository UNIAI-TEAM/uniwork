"use client";

import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as people from "../api/endpoints/people";
import type { DepartmentInput, PeopleFilters, ProfileInput } from "../types/people";

/**
 * Query keys for the directory. Everything is scoped by organization slug —
 * the same person has a different profile in each organization, so a key
 * without the slug would serve one company's directory to another.
 */
/**
 * The prefix every people query shares. Realtime events name the organization
 * by id while these keys carry its slug, so the sync invalidates the prefix
 * rather than pretending it can map one to the other.
 */
export const peopleRootKey = ["people"] as const;

export const peopleKeys = {
  all: (orgSlug: string) => ["people", orgSlug] as const,
  list: (orgSlug: string, filters: PeopleFilters) => ["people", orgSlug, "list", filters] as const,
  detail: (orgSlug: string, userId: string) => ["people", orgSlug, "detail", userId] as const,
  departments: (orgSlug: string, includeArchived: boolean) =>
    ["people", orgSlug, "departments", includeArchived] as const,
};

/** The directory, paged by the opaque cursor the server hands back. */
export function usePeople(orgSlug: string, filters: PeopleFilters) {
  return useInfiniteQuery({
    queryKey: peopleKeys.list(orgSlug, filters),
    queryFn: ({ pageParam }) => people.listPeople(orgSlug, filters, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next_cursor || undefined,
    enabled: !!orgSlug,
  });
}

export function usePerson(orgSlug: string, userId: string) {
  return useQuery({
    queryKey: peopleKeys.detail(orgSlug, userId),
    queryFn: () => people.getPerson(orgSlug, userId),
    enabled: !!orgSlug && !!userId,
  });
}

export function useUpdateProfile(orgSlug: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, input }: { userId: string; input: ProfileInput }) =>
      people.updateProfile(orgSlug, userId, input),
    // An edit can change the name the list sorts by and the department it
    // filters on, so the whole directory is refetched rather than patched.
    onSuccess: (_data, { userId }) => {
      void qc.invalidateQueries({ queryKey: peopleKeys.detail(orgSlug, userId) });
      void qc.invalidateQueries({ queryKey: peopleKeys.all(orgSlug) });
    },
  });
}

export function useDepartments(orgSlug: string, includeArchived = false) {
  return useQuery({
    queryKey: peopleKeys.departments(orgSlug, includeArchived),
    queryFn: () => people.listDepartments(orgSlug, includeArchived),
    enabled: !!orgSlug,
  });
}

export function useCreateDepartment(orgSlug: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: DepartmentInput) => people.createDepartment(orgSlug, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: peopleKeys.all(orgSlug) }),
  });
}

export function useUpdateDepartment(orgSlug: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: DepartmentInput }) =>
      people.updateDepartment(orgSlug, id, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: peopleKeys.all(orgSlug) }),
  });
}

export function useArchiveDepartment(orgSlug: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => people.archiveDepartment(orgSlug, id),
    onSuccess: () => qc.invalidateQueries({ queryKey: peopleKeys.all(orgSlug) }),
  });
}

export function useReorderDepartments(orgSlug: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ids: string[]) => people.reorderDepartments(orgSlug, ids),
    onSuccess: () => qc.invalidateQueries({ queryKey: peopleKeys.all(orgSlug) }),
  });
}
