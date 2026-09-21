/** Injected into cached HTML bodies so layout tables keep their intended width. */
export const EMAIL_HTML_RESET = `<meta charset="utf-8"><base target="_blank" rel="noopener"><style id="uniwork-email-reset">html,body{margin:0;padding:0;width:100%!important;max-width:100%!important;background:transparent;}body{padding:0;box-sizing:border-box;word-wrap:break-word;overflow-wrap:anywhere;overflow-x:auto;text-align:left;}img,video{max-width:100%!important;height:auto!important;}a{color:inherit;}</style>`;

export function wrapEmailHtml(html: string) {
  if (/<html[\s>]/i.test(html)) {
    if (/<head[\s>]/i.test(html)) {
      return html.replace(/<head([^>]*)>/i, `<head$1>${EMAIL_HTML_RESET}`);
    }
    return html.replace(/<html([^>]*)>/i, `<html$1><head>${EMAIL_HTML_RESET}</head>`);
  }
  return `<!DOCTYPE html><html><head>${EMAIL_HTML_RESET}</head><body>${html}</body></html>`;
}
