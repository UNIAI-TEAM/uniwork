// The Markdown WYSIWYG core (UNI-928 M1): the TipTap visual editor over the
// shared source text port, the byte-faithful source <-> editor serialisation,
// and the opaque raw node that keeps unrepresentable content verbatim.
// The toolbar (M2), slash menu (M3), pickers (M4), images (M5), outline and
// front matter (M6), find (M7) and print (M8) mount around this module.
export { MarkdownWysiwygEditor, type MarkdownWysiwygEditorProps } from "./editor";
export {
  createMarkdownEditorExtensions,
  hasMarkdownManager,
  MARKDOWN_LEAD_ATTRIBUTE,
  MARKDOWN_LIST_INDENT,
  MarkdownRawExtension,
  MarkdownSourceGapsExtension,
  SelectiveMarkdown,
} from "./extensions";
export {
  createMarkdownSourceCodec,
  createMarkdownSourceManager,
  fromEditorDocument,
  MARKDOWN_DEFAULT_SEPARATOR,
  toEditorDocument,
  type MarkdownSourceCodec,
} from "./serialize";
export {
  MARKDOWN_RAW_NODE_NAME,
  rawNodeSource,
  RAW_TOKENIZER_LIMIT,
} from "./raw-node";
export { escapeSelectiveMarkdownText } from "./escape";
