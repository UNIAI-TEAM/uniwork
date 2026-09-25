import type { ActorFilterValue } from "@uniwork/core/tasks/stores/view-store-types";
import type { TaskProperty } from "@uniwork/core/types";
import { NO_PROPERTY_VALUE } from "../utils/filter";
import { propertyOptions } from "../properties/property-value";

export function summarizeChipNames(names: (string | undefined)[]): string {
  const first = names.find((n): n is string => !!n);
  if (first === undefined) return String(names.length);
  const rest = names.length - 1;
  return rest > 0 ? `${first} +${rest}` : first;
}

export function buildChipActorNames(
  members: readonly {
    user_id: string;
    display_name?: string;
    email?: string;
    name?: string;
  }[],
  agents: readonly { id: string; name: string }[],
): (actor: ActorFilterValue) => string | undefined {
  const byKey = new Map<string, string>();
  for (const m of members) {
    byKey.set(
      `member:${m.user_id}`,
      m.display_name || m.name || m.email || m.user_id,
    );
  }
  for (const a of agents) byKey.set(`agent:${a.id}`, a.name);
  return (actor: ActorFilterValue) => byKey.get(`${actor.type}:${actor.id}`);
}

function isActorPropertyType(type: string): boolean {
  return type === "actor" || type === "multi_actor";
}

export function hasActorPropertyFilterSelection(
  propertyFilters: Record<string, string[]>,
  properties: { id: string; type: string }[],
): boolean {
  return Object.entries(propertyFilters).some(
    ([propertyId, selected]) =>
      selected.length > 0 &&
      isActorPropertyType(
        properties.find((p) => p.id === propertyId)?.type ?? "",
      ),
  );
}

/** Parse `member:<id>` / `agent:<id>` / `squad:<id>` filter values. */
export function parseActorRef(
  value: string,
): { kind: ActorFilterValue["type"]; id: string } | null {
  const sep = value.indexOf(":");
  if (sep <= 0) return null;
  const kind = value.slice(0, sep);
  const id = value.slice(sep + 1);
  if (!id) return null;
  if (kind !== "member" && kind !== "agent" && kind !== "squad") return null;
  return { kind, id };
}

export function actorFilterValues(selected: string[]): ActorFilterValue[] {
  return selected
    .map((value) => parseActorRef(value))
    .filter(
      (ref): ref is NonNullable<ReturnType<typeof parseActorRef>> =>
        ref !== null,
    )
    .map((ref) => ({ type: ref.kind, id: ref.id }));
}

export function propertyFilterOptionLabel(
  property: TaskProperty,
  optionId: string,
  t: (key: string) => string,
  actorName: (actor: ActorFilterValue) => string | undefined,
): string | undefined {
  if (optionId === NO_PROPERTY_VALUE) {
    return t("tasks.table.no_value");
  }
  if (isActorPropertyType(property.type)) {
    const ref = parseActorRef(optionId);
    return ref ? actorName({ type: ref.kind, id: ref.id }) : undefined;
  }
  if (property.type === "checkbox") {
    return optionId === "true"
      ? t("tasks.table.checked")
      : t("tasks.table.unchecked");
  }
  return propertyOptions(property).find((o) => o.id === optionId)?.name;
}

export function propertyFilterOptionColors(
  property: TaskProperty,
  selected: string[],
): string[] {
  if (property.type === "checkbox" || isActorPropertyType(property.type)) {
    return [];
  }
  return selected
    .map(
      (id) => propertyOptions(property).find((o) => o.id === id)?.color,
    )
    .filter((c): c is string => !!c);
}

export { isActorPropertyType };
