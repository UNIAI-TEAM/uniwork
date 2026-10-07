/** @vitest-environment jsdom */
import { render } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import type { OfficePrintPort } from "@uniwork/views/office/print";
import { desktopEditorLoader, type DesktopEditorLoaderConfig } from "./editor-registry";

// Each format view is stubbed: only the props the desktop hands it matter here.
const probe = vi.hoisted(() => ({ props: {} as Record<string, Record<string, unknown>> }));
vi.mock("@uniwork/views/office/docx", () => ({ DocxEditor: (props: Record<string, unknown>) => { probe.props.docx = props; return null; } }));
vi.mock("@uniwork/views/office/pdf", () => ({
  createPdfEditorLoader: (config: Record<string, unknown>) => async () => { probe.props.pdf = config; return { default: () => null }; },
}));
vi.mock("@uniwork/views/office/markdown", () => ({ MarkdownEditor: (props: Record<string, unknown>) => { probe.props.md = props; return null; } }));
vi.mock("@uniwork/views/office/html", () => ({ HtmlEditor: (props: Record<string, unknown>) => { probe.props.html = props; return null; } }));

const printPort: OfficePrintPort = { print: async () => ({ outcome: "printed" }) };

function config(): DesktopEditorLoaderConfig {
  const session = { editor: {}, coordinator: {}, openEditor: vi.fn() };
  return { documentKey: "doc-1", title: "Doc", session: session as never, capability: {} as never, surfaceVersion: 0, printPort };
}

it.each(["docx", "pdf", "md", "html"] as const)("hands the %s view the desktop print port", async (format) => {
  const loader = desktopEditorLoader(format, config());
  expect(loader).toBeDefined();
  const loaded = await loader!(format);
  const Editor = "default" in loaded ? loaded.default : loaded;
  render(<Editor format={format} host={{} as never} editorHandle={{} as never} />);
  expect(probe.props[format]?.printPort).toBe(printPort);
});
