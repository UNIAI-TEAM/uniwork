"use client";

// UNI-924 A6-wire: the surface-side half of the View tab. Mounted once by the
// editor shell (docx-editor.tsx) as the first child of the canvas column so the
// ruler can sit above the pages. It attaches the shared zoom controller to the
// live `.doc-zoom` element and renders the read-only ruler from the same
// surface geometry.
//
// It takes no toolbar context on purpose: the handle exposes no engine
// accessors, so the surface is resolved from the DOM ids the shell renders (see
// ./surface-targets) and everything stays inside view/**.

import { useEffect } from "react";
import { DocxRuler } from "./ruler";
import { requireDocxScope, useOptionalDocxDocumentScope, type DocxDocumentScope } from "../editor-store";
import type { DocxZoomController } from "./zoom-controller";
import { useDocxEffectiveZoomPercent } from "./zoom-control";
import { useDocxViewSurface } from "./surface-targets";

export interface DocxViewChromeProps {
  /** The shared controller; defaults to this document's scope controller so
   *  the View tab's control and this mount always drive the same surface. */
  controller?: DocxZoomController;
  /** The document; defaults to the surrounding DocxEditor's scope. */
  scope?: DocxDocumentScope;
}

/** Attaches the zoom controller to the mounted surface and shows the ruler. */
export function DocxViewChrome({ controller, scope: explicitScope }: DocxViewChromeProps) {
  const contextScope = useOptionalDocxDocumentScope();
  const scope = requireDocxScope(explicitScope ?? contextScope);
  const resolved = controller ?? scope.zoom;
  const surface = useDocxViewSurface(scope);
  const zoomPercent = useDocxEffectiveZoomPercent(resolved);

  useEffect(() => {
    if (!surface) return undefined;
    resolved.attach({
      zoomElement: surface.zoomElement,
      scrollElement: surface.scrollElement,
      pageSize: surface.pageSize,
    });
    return () => resolved.detach();
  }, [resolved, surface]);

  if (!surface?.settings) return null;
  return (
    <div className="flex shrink-0 justify-center px-3 pt-1" data-testid="docx-view-chrome">
      <DocxRuler settings={surface.settings} zoomPercent={zoomPercent} />
    </div>
  );
}
