/**
 * Localized names for master/layout elements (UNI-939 visual fix). The engine
 * reports raw OOXML tokens (`<p:ph type>`: title, body, dt, ftr, sldNum ...) and
 * element types (shape, picture ...); the panel chips and the canvas preview
 * show these names instead. Pure: the caller passes its `t`.
 */
import type { MasterElementView } from "./masters-model";

/** ST_PlaceholderType tokens with their own copy; an unknown token reads "Placeholder". */
const PLACEHOLDER_KEYS: Readonly<Record<string, string>> = {
  title: "placeholder_title",
  ctrTitle: "placeholder_ctrtitle",
  subTitle: "placeholder_subtitle",
  body: "placeholder_body",
  obj: "placeholder_obj",
  pic: "placeholder_pic",
  chart: "placeholder_chart",
  tbl: "placeholder_tbl",
  clipArt: "placeholder_clipart",
  dgm: "placeholder_dgm",
  media: "placeholder_media",
  sldImg: "placeholder_sldimg",
  dt: "placeholder_dt",
  ftr: "placeholder_ftr",
  hdr: "placeholder_hdr",
  sldNum: "placeholder_sldnum",
};

/** The engine's element types; an unknown type reads "Element". */
const TYPE_KEYS: Readonly<Record<string, string>> = {
  text: "type_text",
  shape: "type_shape",
  picture: "type_picture",
  group: "type_group",
  table: "type_table",
  chart: "type_chart",
  passthrough: "type_passthrough",
};

type Translate = (key: string) => string;

/** The localized kind of an element: its placeholder slot, else its type. */
export function masterElementName(element: Pick<MasterElementView, "placeholder" | "type">, t: Translate): string {
  if (element.placeholder) return t("masters." + (PLACEHOLDER_KEYS[element.placeholder] ?? "placeholder_other"));
  return t("masters." + (TYPE_KEYS[element.type] ?? "type_other"));
}

const SNIPPET_MAX = 40;

/** The element's text flattened to one line and capped, or "" when it has none. */
export function masterElementSnippet(element: Pick<MasterElementView, "text">): string {
  const flat = (element.text ?? "").replace(/\s+/g, " ").trim();
  return flat.length > SNIPPET_MAX ? flat.slice(0, SNIPPET_MAX - 1) + "…" : flat;
}
