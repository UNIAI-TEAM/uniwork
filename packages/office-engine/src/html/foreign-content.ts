// Foreign content (svg, math) as the HTML tree builder sees it, reduced to
// the one question the reference scanner asks: "is the next tag parsed as
// HTML (where <style>/<title>/<script>/<textarea> bodies are raw text) or as
// foreign content (where their children are live elements)?"
//
// Getting this wrong in the "HTML" direction hides a live <a>/<image> from
// the preview rewrite (FE review r1 F-2, r2 N-1, r3 R3-1), so the model
// follows the tree-construction rules of the HTML standard (§13.2.6.5 "The
// rules for parsing tokens in foreign content" and the dispatcher) for every
// element that can change the answer. Elements that cannot change it are not
// tracked. Where the model must approximate (untracked HTML elements inside
// an integration point), it errs toward "foreign", which only over-scans.

/** A tracked open element. `mode` is how the NEXT token is parsed while this
 * element is the innermost tracked one. */
interface Frame {
  tag: string;
  /** Namespace of the element itself. */
  ns: "svg" | "math";
  /** "foreign": children parsed as foreign content; "html": an HTML
   * integration point or MathML text integration point. */
  mode: "foreign" | "html";
}

const SVG_HTML_INTEGRATION_POINTS: ReadonlySet<string> = new Set(["foreignobject", "desc", "title"]);
const MATH_TEXT_INTEGRATION_POINTS: ReadonlySet<string> = new Set(["mi", "mo", "mn", "ms", "mtext"]);
const BREAKOUT: ReadonlySet<string> = new Set(
  ("b big blockquote body br center code dd div dl dt em embed h1 h2 h3 h4 h5 h6 head hr i img li listing " +
    "menu meta nobr ol p pre ruby s small span strong strike sub sup table tt u ul var").split(" "),
);

export interface ForeignContentTracker {
  /** True when the next tag is parsed as foreign content. */
  inForeign(): boolean;
  startTag(tag: string, attrs: ReadonlyArray<{ name: string; value: string }>, selfClosing: boolean): void;
  endTag(tag: string): void;
}

function htmlEncoded(attrs: ReadonlyArray<{ name: string; value: string }>): boolean {
  const encoding = (attrs.find((a) => a.name === "encoding")?.value ?? "").trim().toLowerCase();
  return encoding === "text/html" || encoding === "application/xhtml+xml";
}

export function createForeignContentTracker(): ForeignContentTracker {
  const stack: Frame[] = [];
  const top = (): Frame | undefined => stack[stack.length - 1];
  const inForeign = () => top()?.mode === "foreign";

  // "Pop until the current node is a MathML text integration point, an HTML
  // integration point, or an element in the HTML namespace."
  const breakOut = () => {
    while (inForeign()) stack.pop();
  };

  return {
    inForeign,

    startTag(tag, attrs, selfClosing) {
      const current = top();
      if (current === undefined || current.mode === "html") {
        // HTML rules: only <svg>/<math> open foreign content (a self-closing
        // one is popped at once).
        if (!selfClosing && (tag === "svg" || tag === "math")) stack.push({ tag, ns: tag, mode: "foreign" });
        return;
      }
      // Foreign content.
      const fontBreakout = tag === "font" && attrs.some((a) => a.name === "color" || a.name === "face" || a.name === "size");
      if (BREAKOUT.has(tag) || fontBreakout) {
        breakOut();
        return;
      }
      if (selfClosing) return;
      // Dispatcher: <svg> directly inside MathML annotation-xml is processed
      // by HTML rules, i.e. it opens a real SVG root.
      if (tag === "svg" && current.ns === "math" && current.tag === "annotation-xml") {
        stack.push({ tag, ns: "svg", mode: "foreign" });
        return;
      }
      const ns = current.ns;
      // Any other start tag is inserted in the CURRENT namespace: <math>
      // inside svg is an svg-namespace element named "math", and so on.
      if (ns === "svg" && SVG_HTML_INTEGRATION_POINTS.has(tag)) {
        stack.push({ tag, ns, mode: "html" });
      } else if (ns === "math" && MATH_TEXT_INTEGRATION_POINTS.has(tag)) {
        stack.push({ tag, ns, mode: "html" });
      } else if (ns === "math" && tag === "annotation-xml") {
        stack.push({ tag, ns, mode: htmlEncoded(attrs) ? "html" : "foreign" });
      } else if (tag === "svg" || tag === "math") {
        // Same-namespace element with a root's name: tracked so its end tag
        // pops it and not the real root.
        stack.push({ tag, ns, mode: "foreign" });
      }
    },

    endTag(tag) {
      const current = top();
      if (current === undefined) return;
      if (current.mode === "html") {
        // Inside an integration point the parser may have HTML elements open
        // that we do not track; with one open, an end tag naming the svg/math
        // root is ignored (the open element is special), and the parser only
        // returns to svg when the integration point itself closes. So only
        // the integration point's own end tag pops it. Where the parser pops
        // more (no HTML element open), we stay in HTML mode inside the
        // integration point and later pop to foreign: an over-scan, never an
        // under-scan.
        if (tag === current.tag) stack.pop();
        return;
      }
      if (tag === "br" || tag === "p") {
        breakOut();
        return;
      }
      // Foreign rules: walk down through foreign elements to the first with
      // this name.
      for (let at = stack.length - 1; at >= 0; at--) {
        if (stack[at]!.tag === tag) {
          stack.length = at;
          return;
        }
      }
    },
  };
}
