// G7-08 (UNI-1385) bound-document tool-surface constants (docs/office/g5g6g7/genoffice-tools.md §8.1).
// Pure constants module with zero filesystem or network I/O.

export const PDF_FILE_LEVEL_PAGE_TOOLS = Object.freeze([
  'insert_blank_page',
  'set_page_size',
  'crop_pages',
  'replace_pages',
  'extract_pages',
  'split_pdf',
  'split_pages',
  'merge_pages',
]);

export const BOUND_DOCUMENT_FORBIDDEN_TOOLS = Object.freeze([
  'create_document',
  ...PDF_FILE_LEVEL_PAGE_TOOLS,
]);
