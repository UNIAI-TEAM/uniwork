/**
 * The personal home layout: which sections show, in what order, at what
 * density. The server stores whatever object it is given; this module is the
 * contract, and `normalizeHomePrefs` is the only way a stored value becomes a
 * layout — unknown keys drop, missing keys take their default. A section
 * that no longer exists (the old "brief") drops the same way.
 */
export const HOME_SECTION_KEYS = ["stats", "mywork", "upcoming", "inbox"] as const;
export type HomeSectionKey = (typeof HOME_SECTION_KEYS)[number];

export const HOME_LAYOUTS = ["compact", "balanced", "wide"] as const;
export type HomeLayout = (typeof HOME_LAYOUTS)[number];

export type HomePrefs = {
  enabled: Record<HomeSectionKey, boolean>;
  order: HomeSectionKey[];
  layout: HomeLayout;
};

export const DEFAULT_HOME_PREFS: HomePrefs = {
  enabled: { stats: true, mywork: true, upcoming: true, inbox: true },
  order: ["stats", "mywork", "upcoming", "inbox"],
  layout: "balanced",
};

export type HomePresetKey = "executive" | "doer" | "minimal";

export const HOME_PRESETS: { key: HomePresetKey; prefs: HomePrefs }[] = [
  {
    key: "executive",
    prefs: {
      enabled: { stats: true, mywork: true, upcoming: false, inbox: true },
      order: ["stats", "inbox", "mywork", "upcoming"],
      layout: "balanced",
    },
  },
  {
    key: "doer",
    prefs: {
      enabled: { stats: true, mywork: true, upcoming: true, inbox: false },
      order: ["stats", "mywork", "upcoming", "inbox"],
      layout: "balanced",
    },
  },
  {
    key: "minimal",
    prefs: {
      enabled: { stats: false, mywork: true, upcoming: false, inbox: false },
      order: ["mywork", "stats", "upcoming", "inbox"],
      layout: "compact",
    },
  },
];

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const isSectionKey = (v: unknown): v is HomeSectionKey =>
  typeof v === "string" && (HOME_SECTION_KEYS as readonly string[]).includes(v);

const isLayout = (v: unknown): v is HomeLayout =>
  typeof v === "string" && (HOME_LAYOUTS as readonly string[]).includes(v);

export function normalizeHomePrefs(raw: unknown): HomePrefs {
  const obj = isRecord(raw) ? raw : {};
  const enabledRaw = isRecord(obj.enabled) ? obj.enabled : {};
  const enabled = { ...DEFAULT_HOME_PREFS.enabled };
  for (const key of HOME_SECTION_KEYS) {
    const value = enabledRaw[key];
    if (typeof value === "boolean") enabled[key] = value;
  }
  const order: HomeSectionKey[] = [];
  for (const value of Array.isArray(obj.order) ? obj.order : []) {
    if (isSectionKey(value) && !order.includes(value)) order.push(value);
  }
  for (const key of DEFAULT_HOME_PREFS.order) {
    if (!order.includes(key)) order.push(key);
  }
  return { enabled, order, layout: isLayout(obj.layout) ? obj.layout : DEFAULT_HOME_PREFS.layout };
}

/** Swaps a section with its neighbour; at either end the order is unchanged. */
export function moveSection(order: HomeSectionKey[], key: HomeSectionKey, dir: -1 | 1): HomeSectionKey[] {
  const from = order.indexOf(key);
  const to = from + dir;
  if (from < 0 || to < 0 || to >= order.length) return order;
  const next = [...order];
  next[from] = next[to]!;
  next[to] = key;
  return next;
}

export function visibleSections(prefs: HomePrefs): HomeSectionKey[] {
  return prefs.order.filter((key) => prefs.enabled[key]);
}

/** The preset a layout is exactly equal to, so the picker can mark it. */
export function activePreset(prefs: HomePrefs): HomePresetKey | undefined {
  return HOME_PRESETS.find(
    (preset) =>
      preset.prefs.layout === prefs.layout &&
      preset.prefs.order.every((key, i) => prefs.order[i] === key) &&
      HOME_SECTION_KEYS.every((key) => preset.prefs.enabled[key] === prefs.enabled[key]),
  )?.key;
}
