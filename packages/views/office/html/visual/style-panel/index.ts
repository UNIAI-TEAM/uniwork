// @uniwork/views HTML visual style panel (H7). A pure, presentational surface:
// it renders the current style values and reports intent through callbacks, so
// it never reads the DOM, calls an H3 op or sends an inspector command.
export { HtmlStylePanel, type HtmlStylePanelProps } from "./style-panel";
export { BackgroundColourField, type BackgroundColourFieldProps } from "./colour-field";
export {
  applyAspectLock,
  clampOpacity,
  clampStyleSize,
  CUSTOM_CSS_MAX_LENGTH,
  defaultHtmlStyleValues,
  fontFamilyFromSelectValue,
  HTML_STYLE_ALIGNMENTS,
  HTML_STYLE_FITS,
  HTML_STYLE_FONT_FAMILIES,
  HTML_STYLE_FONT_INHERIT,
  HTML_STYLE_FONT_WEIGHTS,
  isPlainCssString,
  mergeHtmlStyleValues,
  normalizeCustomCss,
  normalizeHexColour,
  selectValueForFontFamily,
  STYLE_OPACITY_DEFAULT,
  STYLE_OPACITY_MAX,
  STYLE_OPACITY_MIN,
  STYLE_SIZE_MAX,
  STYLE_SIZE_MIN,
  type HtmlStyleAlign,
  type HtmlStyleFit,
  type HtmlStyleFontWeight,
  type HtmlStylePatch,
  type HtmlStyleSize,
  type HtmlStyleValues,
} from "./model";
