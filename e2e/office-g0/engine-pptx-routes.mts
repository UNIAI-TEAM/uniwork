// DOC-003 engine host: PPTX session routes on the real engine + op executor.
//
// The slides renderer holds no document bytes: it opens a deck, edits it, and
// asks the server to save the held session. This module owns that session map,
// keyed by transport viewId (per view, never shared), and keeps the same
// renderer-facing result shapes the slides IPC declares:
//   editText  -> RenderSlide                       (here: a full render)
//   addImageBytes / replacePictureBytes / addElement -> {slide, sourceId}
//   editTransform -> RenderSlide
//   save -> {ok, path?}; saveAs -> {ok, path?}; isDirty -> boolean
// A deck is opened from a snapshot inside the lab, so the original fixture is
// never mutated by an edit, and a failed transaction leaves the session (and
// the previous saved output) untouched.
import { basename } from "node:path";
import { snapshotCopy } from "./engine-paths.mts";
import type { HostContext, RouteMap } from "./engine-host-context.mts";
import {
  EngineRequestError,
  optionalNumber,
  optionalString,
  requireArray,
  requireString,
} from "./engine-host-context.mts";
import { PptxEngineError } from "./engine-pptx-types.mts";
import type {
  OpenedPptxLike,
  PptxAddElementInput,
  PptxAddImageInput,
  PptxEditParagraph,
  PptxEditTransformInput,
  PptxReplacePictureInput,
} from "./engine-pptx-types.mts";
import { elementText } from "./engine-pptx.mts";

/** One open deck, owned by exactly one view. */
export interface PptxSession {
  viewId: string;
  sourcePath: string;
  snapshotPath: string;
  opened: OpenedPptxLike;
  inHash: string;
  inBytes: number;
  fitWidthPx: number;
  dirty: boolean;
  savedPath?: string;
  /** Deck events the renderer should receive; lab-server replays them on poll. */
  events: { type: string; payload: Record<string, unknown> }[];
}

const DEFAULT_FIT_WIDTH = 960;

const summaryOf = (opened: OpenedPptxLike): Record<string, unknown> => ({
  slides: opened.deck.slides.map((slide, index) => ({
    index,
    elements: slide.elements.map((el) => ({ id: el.id, type: el.type, text: elementText(el).slice(0, 200) })),
  })),
});

export function createPptxRoutes(ctx: HostContext) {
  const sessions = new Map<string, PptxSession>();

  const requireSession = (viewId: string): PptxSession => {
    const session = sessions.get(viewId);
    if (!session) throw new EngineRequestError("no_session", "no open deck for view " + viewId);
    return session;
  };

  const openInto = async (viewId: string, sourcePath: string, fitWidthPx: number): Promise<PptxSession> => {
    if (sessions.has(viewId)) {
      throw new EngineRequestError("session_exists", "view " + viewId + " already owns a deck");
    }
    const pptx = await ctx.engines.pptx;
    const copy = await snapshotCopy(ctx.sessionDir(viewId), sourcePath);
    const opened = await pptx.open(new Uint8Array(await ctx.read(copy.path)));
    const session: PptxSession = {
      viewId,
      sourcePath,
      snapshotPath: copy.path,
      opened,
      inHash: copy.hash,
      inBytes: copy.bytes,
      fitWidthPx,
      dirty: false,
      events: [],
    };
    sessions.set(viewId, session);
    return session;
  };

  const fitWidthOf = (input: Record<string, unknown>): number =>
    optionalNumber(input.fitWidthPx, "fitWidthPx") ?? DEFAULT_FIT_WIDTH;

  const slideIndexOf = (input: Record<string, unknown>): number =>
    optionalNumber(input.slideIndex, "slideIndex") ?? optionalNumber(input.slide, "slide") ?? 0;

  /** Render one slide through the real pptx-render layer for the current viewport. */
  const renderSlide = async (session: PptxSession, slideIndex: number): Promise<unknown> => {
    const pptx = await ctx.engines.pptx;
    const slides = await pptx.renderSlides(session.opened, session.fitWidthPx);
    const slide = slides[slideIndex];
    if (slide === undefined) throw new EngineRequestError("no_slide", "no slide " + slideIndex);
    return slide;
  };

  const stageSave = async (session: PptxSession, name: string): Promise<string> => {
    const pptx = await ctx.engines.pptx;
    const bytes = await pptx.save(session.opened);
    // Reopen the produced bytes: a save nobody can read back is not a save.
    const reopened = await pptx.open(bytes);
    if (reopened.deck.slides.length === 0) {
      throw new PptxEngineError("save_verify_failed", "saved deck reopened with no slides");
    }
    const path = await ctx.stage(session.viewId, name, bytes);
    session.savedPath = path;
    session.dirty = false;
    session.events.push({ type: "deck.saved", payload: { path, slides: reopened.deck.slides.length } });
    return path;
  };

  const editText = async (input: Record<string, unknown>): Promise<Record<string, unknown>> => {
    const session = requireSession(requireString(input.viewId, "viewId"));
    const pptx = await ctx.engines.pptx;
    const slideIndex = slideIndexOf(input);
    const sourceId = optionalString(input.sourceId ?? input.el, "sourceId");
    const paragraphs = requireArray<PptxEditParagraph>(input.paragraphs, "paragraphs");
    const before = elementText(
      session.opened.deck.slides[slideIndex]?.elements.find((el) => el.id === sourceId),
    );
    const result = await pptx.editText({
      opened: session.opened,
      slideIndex,
      elementId: sourceId,
      paragraphs,
      ...(optionalString(input.groupId, "groupId") ? { groupId: input.groupId as string } : {}),
    });
    session.dirty = true;
    const after = elementText(
      session.opened.deck.slides[slideIndex]?.elements.find((el) => el.id === result.targetId),
    );
    session.events.push({
      type: "deck.edited",
      payload: { slideIndex, sourceId: result.targetId, before, after },
    });
    return {
      ok: true,
      slideIndex,
      sourceId: result.targetId,
      elementType: result.targetType,
      beforeText: before,
      afterText: after,
      applied: result.applied,
      failures: result.failures,
      slide: await renderSlide(session, slideIndex),
    };
  };

  const editTransform = async (input: Record<string, unknown>): Promise<Record<string, unknown>> => {
    const session = requireSession(requireString(input.viewId, "viewId"));
    const pptx = await ctx.engines.pptx;
    const slideIndex = slideIndexOf(input);
    const op: PptxEditTransformInput = {
      opened: session.opened,
      slideIndex,
      elementId: requireString(input.sourceId ?? input.el, "sourceId"),
      xPx: Number(input.xPx),
      yPx: Number(input.yPx),
      wPx: Number(input.wPx),
      hPx: Number(input.hPx),
      rotationDeg: Number(input.rotationDeg ?? 0),
      fitWidthPx: fitWidthOf(input),
      ...(optionalString(input.groupId, "groupId") ? { groupId: input.groupId as string } : {}),
    };
    const result = await pptx.editTransform(op);
    session.dirty = true;
    session.events.push({
      type: "deck.edited",
      payload: { slideIndex, sourceId: op.elementId, op: "setTransform" },
    });
    return { ok: true, sourceId: result.targetId, slide: await renderSlide(session, slideIndex) };
  };

  const addElement = async (input: Record<string, unknown>): Promise<Record<string, unknown>> => {
    const session = requireSession(requireString(input.viewId, "viewId"));
    const pptx = await ctx.engines.pptx;
    const slideIndex = slideIndexOf(input);
    const op: PptxAddElementInput = {
      opened: session.opened,
      slideIndex,
      kind: requireString(input.kind, "kind"),
      xPx: Number(input.xPx),
      yPx: Number(input.yPx),
      wPx: Number(input.wPx),
      hPx: Number(input.hPx),
      fitWidthPx: fitWidthOf(input),
      ...(Array.isArray(input.paragraphs) && input.paragraphs.length > 0
        ? { paragraphs: input.paragraphs as PptxEditParagraph[] }
        : {}),
      ...(typeof input.fillColor === "string" ? { fillColor: input.fillColor } : {}),
      ...(typeof input.stroke === "object" && input.stroke !== null
        ? { stroke: input.stroke as { color: string; widthPt: number } }
        : {}),
    };
    const result = await pptx.addElement(op);
    session.dirty = true;
    session.events.push({
      type: "deck.edited",
      payload: { slideIndex, sourceId: result.createdId, op: "addElement" },
    });
    return { ok: true, sourceId: result.createdId, slide: await renderSlide(session, slideIndex) };
  };

  const addImageBytes = async (input: Record<string, unknown>): Promise<Record<string, unknown>> => {
    const session = requireSession(requireString(input.viewId, "viewId"));
    const pptx = await ctx.engines.pptx;
    const slideIndex = slideIndexOf(input);
    const op: PptxAddImageInput = {
      opened: session.opened,
      slideIndex,
      base64: requireString(input.base64, "base64"),
      ext: requireString(input.ext, "ext"),
      xPx: Number(input.xPx),
      yPx: Number(input.yPx),
      wPx: Number(input.wPx),
      hPx: Number(input.hPx),
      fitWidthPx: fitWidthOf(input),
    };
    let createdId: string;
    try {
      createdId = (await pptx.addImageBytes(op)).createdId;
    } catch (error) {
      if (error instanceof PptxEngineError && error.code === "unsupported_image") {
        // The renderer expects { error: 'unsupported', ext } on an unsupported format.
        return { ok: false, error: "unsupported", ext: op.ext };
      }
      throw error;
    }
    session.dirty = true;
    session.events.push({
      type: "deck.edited",
      payload: { slideIndex, sourceId: createdId, op: "addPicture" },
    });
    return { ok: true, sourceId: createdId, slide: await renderSlide(session, slideIndex) };
  };

  const replacePictureBytes = async (input: Record<string, unknown>): Promise<Record<string, unknown>> => {
    const session = requireSession(requireString(input.viewId, "viewId"));
    const pptx = await ctx.engines.pptx;
    const slideIndex = slideIndexOf(input);
    const op: PptxReplacePictureInput = {
      opened: session.opened,
      slideIndex,
      elementId: requireString(input.sourceId ?? input.el, "sourceId"),
      base64: requireString(input.base64, "base64"),
      ext: requireString(input.ext, "ext"),
      ...(input.keepSrcRect === true ? { keepSrcRect: true } : {}),
    };
    let targetId: string;
    try {
      targetId = (await pptx.replacePictureBytes(op)).targetId;
    } catch (error) {
      if (error instanceof PptxEngineError && error.code === "unsupported_image") {
        return { ok: false, error: "unsupported", ext: op.ext };
      }
      throw error;
    }
    session.dirty = true;
    session.events.push({
      type: "deck.edited",
      payload: { slideIndex, sourceId: targetId, op: "replacePicture" },
    });
    return { ok: true, sourceId: targetId, slide: await renderSlide(session, slideIndex) };
  };

  const routes: RouteMap = {
    // Open a fixture into a private session snapshot. "path" is a lab path.
    "/engine/pptx-open": async (input) => {
      // Validate the view id before the engine/prebundle loads or a snapshot dir is made.
      const viewId = ctx.requireViewId(input.viewId);
      const sourcePath = ctx.labFile(input.path);
      const session = await openInto(viewId, sourcePath, fitWidthOf(input));
      const pptx = await ctx.engines.pptx;
      return {
        viewId,
        path: sourcePath,
        inBytes: session.inBytes,
        inHash: session.inHash,
        size: session.opened.deck.size,
        count: session.opened.deck.slides.length,
        slides: await pptx.renderSlides(session.opened, session.fitWidthPx),
        summary: summaryOf(session.opened),
      };
    },

    // Stateless round-trip on a lab copy: open, save, and prove the deck survived.
    "/engine/pptx-roundtrip": async (input) => {
      const viewId = ctx.requireViewId(input.viewId ?? "pptx");
      const sourcePath = ctx.labFile(input.path);
      const pptx = await ctx.engines.pptx;
      const copy = await snapshotCopy(ctx.sessionDir(viewId), sourcePath);
      const original = await ctx.read(copy.path);
      const opened = await pptx.open(new Uint8Array(original));
      const out = await pptx.save(opened);
      const path = await ctx.stage(viewId, basename(sourcePath), out);
      return {
        path,
        slides: opened.deck.slides.length,
        inBytes: copy.bytes,
        inHash: copy.hash,
        outBytes: out.length,
        outHash: ctx.sha256(out),
        byteIdentical: Buffer.compare(Buffer.from(out), Buffer.from(original)) === 0,
      };
    },

    "/engine/pptx-edit-text": editText,

    "/engine/pptx-edit-transform": editTransform,

    "/engine/pptx-add-element": addElement,

    "/engine/pptx-add-image": addImageBytes,

    "/engine/pptx-replace-picture": replacePictureBytes,

    "/engine/pptx-render": async (input) => {
      const session = requireSession(requireString(input.viewId, "viewId"));
      const fitWidthPx = fitWidthOf(input);
      session.fitWidthPx = fitWidthPx;
      const pptx = await ctx.engines.pptx;
      return { fitWidthPx, slides: await pptx.renderSlides(session.opened, fitWidthPx) };
    },

    "/engine/pptx-save": async (input) => {
      const session = requireSession(requireString(input.viewId, "viewId"));
      const name = optionalString(input.name, "name") ?? basename(session.savedPath ?? session.sourcePath);
      const path = await stageSave(session, name);
      return { ok: true, path, dirty: session.dirty, events: session.events };
    },

    "/engine/pptx-save-as": async (input) => {
      const session = requireSession(requireString(input.viewId, "viewId"));
      const name = optionalString(input.name, "name") ?? optionalString(input.defaultName, "defaultName");
      if (!name) throw new EngineRequestError("bad_input", "save-as needs a name or defaultName");
      const path = await stageSave(session, name);
      return { ok: true, path, dirty: session.dirty, events: session.events };
    },

    "/engine/pptx-drain-events": async (input) => {
      const session = requireSession(requireString(input.viewId, "viewId"));
      const events = session.events.splice(0, session.events.length);
      return { events };
    },

    "/engine/pptx-is-dirty": async (input) => ({
      dirty: requireSession(requireString(input.viewId, "viewId")).dirty,
    }),

    // The renderer mounts the new-slide picker through host:slides-layouts -> pptx-layouts.
    // This is a READ-ONLY catalog of the open deck (pptx-engine listSlideLayouts plus the
    // built-in standard set), the same answer the upstream slides main process gives for
    // slides:get-layouts. It never writes the package, and a deck with no session is refused
    // by name rather than answered with an invented catalog.
    "/engine/pptx-layouts": async (input) => {
      const session = requireSession(requireString(input.viewId, "viewId"));
      const pptx = await ctx.engines.pptx;
      return pptx.listLayouts(session.opened);
    },

    "/engine/pptx-state": async (input) => {
      const session = requireSession(requireString(input.viewId, "viewId"));
      return {
        viewId: session.viewId,
        path: session.sourcePath,
        savedPath: session.savedPath ?? null,
        dirty: session.dirty,
        fitWidthPx: session.fitWidthPx,
        slides: session.opened.deck.slides.length,
        summary: summaryOf(session.opened),
      };
    },
  };

  const closeSession = async (viewId: string): Promise<boolean> => sessions.delete(viewId);

  /** Invalidate every held deck on host shutdown: local state, never engine work. */
  const closeAll = async (): Promise<void> => {
    sessions.clear();
  };

  return { routes, closeSession, closeAll, sessions };
}
