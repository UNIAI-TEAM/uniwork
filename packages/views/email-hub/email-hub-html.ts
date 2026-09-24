/** Injected into cached HTML bodies so layout tables keep their intended width. */
export const EMAIL_HTML_RESET = `<meta charset="utf-8"><base target="_blank" rel="noopener"><style id="uniwork-email-reset">html,body{margin:0;padding:0;width:100%!important;max-width:100%!important;background:transparent;}body{box-sizing:border-box;word-wrap:break-word;overflow-wrap:break-word;overflow-x:auto;text-align:left;line-height:1.5;color:inherit;}img,video{max-width:100%!important;height:auto!important;}a{color:inherit;}table{border-collapse:collapse;}th,td{word-break:normal;overflow-wrap:normal;white-space:normal;vertical-align:top;padding:6px 10px;}th{min-width:3.5rem;font-weight:600;white-space:nowrap;}</style>`;

export function wrapEmailHtml(html: string) {
  if (/<html[\s>]/i.test(html)) {
    if (/<head[\s>]/i.test(html)) {
      return html.replace(/<head([^>]*)>/i, `<head$1>${EMAIL_HTML_RESET}`);
    }
    return html.replace(/<html([^>]*)>/i, `<html$1><head>${EMAIL_HTML_RESET}</head>`);
  }
  return `<!DOCTYPE html><html><head>${EMAIL_HTML_RESET}</head><body>${html}</body></html>`;
}
