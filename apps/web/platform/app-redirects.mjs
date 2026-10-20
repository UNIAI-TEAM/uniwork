/**
 * The Office and UniChat pages moved under /apps (UNI-1913). Their old URLs,
 * in both locales, stay alive as permanent (308) redirects: links already
 * shared, installers' "about" links and search results keep working.
 * next.config.mjs serves these before the proxy runs.
 */
export const APP_REDIRECTS = ["office", "unichat"].flatMap((app) => [
  { source: `/${app}`, destination: `/apps/${app}`, permanent: true },
  { source: `/vi/${app}`, destination: `/vi/apps/${app}`, permanent: true },
]);
