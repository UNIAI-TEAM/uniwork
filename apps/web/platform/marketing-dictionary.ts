import { cache } from "react";
import { loadDictionary, type SupportedLocale } from "@uniwork/core/i18n/server";

/** Keep app/editor translations out of the public RSC payload. */
export const loadMarketingDictionary = cache(async (locale: SupportedLocale, path = "/"): Promise<Record<string, unknown>> => {
  const dictionary = await loadDictionary(locale);
  const settings = dictionary.settings as { preferences?: Record<string, unknown> };
  const topbar = dictionary.topbar as Record<string, unknown>;
  const tasks = dictionary.tasks as Record<string, unknown>;
  const projects = dictionary.projects as Record<string, unknown>;
  const workspace = dictionary.workspace as Record<string, unknown>;
  const office = dictionary.office as { desktop: { install: Record<string, unknown> } };
  const landing = dictionary.landing as Record<string, unknown>;
  const lean = ["/office", "/request-demo", "/about", "/security", "/changelog"].includes(path) || path.startsWith("/learn/");
  const publicLanding = lean ? {
    ...Object.fromEntries(["nav", "cta", "footer", "final", "productPages", "catalog", "solutions", "studio", "workforce", "businessOs", "meetings", "demo"].map(key => [key, landing[key]])),
    office: path === "/office" ? landing.office : { editions: (landing.office as Record<string, unknown>).editions },
  } : landing;
  return {
    landing: publicLanding, changelog: path === "/" || path === "/changelog" ? dictionary.changelog : { title: (dictionary.changelog as Record<string, unknown>).title }, marketingSeo: dictionary.marketingSeo,
    office: { desktop: { install: office.desktop.install } },
    common: dictionary.common, nav: dictionary.nav,
    tasks: { title: tasks.title, status: tasks.status, priority: tasks.priority, comments: tasks.comments },
    projects: { status: projects.status, priority: projects.priority },
    workspace: { members: workspace.members },
    topbar: { theme: topbar.theme, language: topbar.language },
    settings: { preferences: Object.fromEntries(["themeLight", "themeDark", "themeSystem", "languageVi", "languageEn"].map(key => [key, settings.preferences?.[key]])) },
  };
});
