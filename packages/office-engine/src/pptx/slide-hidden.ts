// Hidden-slide state of a parsed slide, read the way the vendored engine
// writes it. The real slide model never carries a `hidden` field: the engine's
// setSlideHidden patches `show="0"` onto the `<p:sld>` open tag held in the
// slide's `bodyPrefix`. Only that open tag is read, so a `show="0"` inside a
// child element, a lookalike attribute (`data-show`) or an id/layout tag
// (`<p:sldId>`, `<p:sldLayout>`) never counts. Browser-safe, no Node.

const SLD_OPEN = /<p:sld\b(?:[^>"']|"[^"]*"|'[^']*')*>/;
const ATTRIBUTE = /\s([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

/** @public — true when a slide's `bodyPrefix` marks the slide hidden. */
export function readSlideHidden(bodyPrefix: string | undefined): boolean {
  const open = bodyPrefix === undefined ? null : SLD_OPEN.exec(bodyPrefix);
  if (open === null) return false;
  for (const [, name, double, single] of open[0].matchAll(ATTRIBUTE)) {
    if (name === "show") return (double ?? single) === "0";
  }
  return false;
}

/** @public — hidden state of a live slide: an explicit flag (fake engines) or `show="0"` in the real one. */
export function isSlideHidden(slide: { hidden?: boolean; bodyPrefix?: string }): boolean {
  return slide.hidden === true || readSlideHidden(slide.bodyPrefix);
}
