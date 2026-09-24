/**
 * Injected into cached HTML bodies so layout tables keep their intended width.
 *
 * The frame is a sheet of paper, not part of the app surface: newsletters and
 * replies are authored for a white page with dark text and carry their own
 * inline colours, so the frame pins that page in BOTH themes. A transparent
 * frame inherited nothing (an iframe document does not see the app's CSS) and
 * in dark mode showed black text on the dark app background. The hex values
 * here therefore describe the email's page, not an app token.
 */
export const EMAIL_HTML_RESET = `<meta charset="utf-8"><meta name="color-scheme" content="light"><base target="_blank" rel="noopener"><style id="uniwork-email-reset">html{background:#ffffff;color-scheme:light;}html,body{margin:0;width:100%!important;max-width:100%!important;}body{box-sizing:border-box;padding:20px 24px 28px;font-family:Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;font-size:14px;line-height:1.6;color:#1f2328;word-wrap:break-word;overflow-wrap:break-word;overflow-x:auto;text-align:left;}p{margin:0 0 12px;}img,video{max-width:100%!important;height:auto!important;}table{border-collapse:collapse;}th,td{word-break:normal;overflow-wrap:normal;white-space:normal;vertical-align:top;padding:6px 10px;}th{min-width:3.5rem;font-weight:600;white-space:nowrap;}blockquote{margin:0 0 12px;padding-left:12px;border-left:3px solid #d0d7de;color:#57606a;}</style>`;

/**
 * Remote images stay off until the reader asks for them: a tracking pixel
 * tells the sender when and where the email was opened. Inline (`data:`/`cid:`)
 * images are the email's own and always show.
 */
const BLOCK_REMOTE_CSP =
  `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: cid: blob:; style-src 'unsafe-inline'; font-src data:">`;

const REMOTE_CONTENT_RE =
  /<img\b[^>]*\bsrc\s*=\s*["']?\s*(?:https?:)?\/\/|url\(\s*["']?\s*(?:https?:)?\/\/|\bbackground\s*=\s*["']?\s*(?:https?:)?\/\/|<link\b[^>]*\bhref\s*=\s*["']?\s*(?:https?:)?\/\//i;

/** Whether the body loads anything from another server — images, backgrounds, stylesheets. */
export function emailHasRemoteContent(html: string) {
  return REMOTE_CONTENT_RE.test(html);
}

export function wrapEmailHtml(html: string, { allowRemote = false }: { allowRemote?: boolean } = {}) {
  const head = `${allowRemote ? "" : BLOCK_REMOTE_CSP}${EMAIL_HTML_RESET}`;
  if (/<html[\s>]/i.test(html)) {
    if (/<head[\s>]/i.test(html)) {
      return html.replace(/<head([^>]*)>/i, `<head$1>${head}`);
    }
    return html.replace(/<html([^>]*)>/i, `<html$1><head>${head}</head>`);
  }
  return `<!DOCTYPE html><html><head>${head}</head><body>${html}</body></html>`;
}
