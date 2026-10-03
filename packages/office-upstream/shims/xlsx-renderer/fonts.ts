import carlitoRegular from "@genoffice/ui/fonts/Carlito-Regular.ttf?url";
import carlitoBold from "@genoffice/ui/fonts/Carlito-Bold.ttf?url";
import type { WorkbookFile } from "../../upstream/apps/sheets/src/shared/desktop-api";

export interface XlsxRendererFontMapping {
  declared: string;
  /** null means browser fallback needs measurement in the visual run. */
  used: string | null;
  source: "local" | "carlito" | "browser-fallback";
}

const localFaces = new WeakMap<Document, Map<string, Promise<boolean>>>();
const calibriFallback = new WeakMap<Document, Promise<boolean>>();
const quoted = (text: string) => `"${text.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

function localFaceExists(doc: Document, family: string): Promise<boolean> {
  let cache = localFaces.get(doc);
  if (!cache) { cache = new Map(); localFaces.set(doc, cache); }
  let probe = cache.get(family);
  if (!probe) {
    // FontFaceSet.check can return true for a nonexistent local family.
    // Loading a local() face proves the declared family actually exists.
    probe = new FontFace("__uniwork-xlsx-font-probe", `local(${quoted(family)})`).load().then(
      () => true, () => false,
    );
    cache.set(family, probe);
  }
  return probe;
}

function installCalibriFallback(doc: Document): Promise<boolean> {
  let loading = calibriFallback.get(doc);
  if (!loading) {
    loading = Promise.all([
      new FontFace("Calibri", `url(${quoted(carlitoRegular)})`, { weight: "400" }).load(),
      new FontFace("Calibri", `url(${quoted(carlitoBold)})`, { weight: "700" }).load(),
    ]).then((faces) => {
      for (const face of faces) doc.fonts.add(face);
      return true;
    }, () => false);
    calibriFallback.set(doc, loading);
  }
  return loading;
}

/** Preserve workbook families; Carlito is only an unavailable-Calibri substitute. */
export async function loadWorkbookFonts(file: WorkbookFile, doc: Document): Promise<XlsxRendererFontMapping[]> {
  const families = new Set([
    file.styles[0]?.fontFamily ?? "Calibri",
    ...file.styles.flatMap((style) => style.fontFamily ? [style.fontFamily] : []),
    ...[file.themeFonts?.major, file.themeFonts?.minor].filter((family): family is string => !!family),
  ]);
  const pending = [...families].map(async (declared): Promise<XlsxRendererFontMapping> => {
    if (typeof FontFace === "undefined" || !doc.fonts) return { declared, used: null, source: "browser-fallback" };
    if (await localFaceExists(doc, declared)) return { declared, used: declared, source: "local" };
    if (declared.toLowerCase() === "calibri" && await installCalibriFallback(doc)) {
      return { declared, used: "Carlito", source: "carlito" };
    }
    return { declared, used: null, source: "browser-fallback" };
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.all(pending),
      new Promise<XlsxRendererFontMapping[]>((resolve) => {
        timer = setTimeout(() => resolve([...families].map((declared) => ({ declared, used: null, source: "browser-fallback" }))), 3000);
      }),
    ]);
  } finally { if (timer !== undefined) clearTimeout(timer); }
}
