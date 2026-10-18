import { cache } from "react";
import { loadDictionary, type SupportedLocale } from "@uniwork/core/i18n/server";

const MEETING_PREVIEW_KEYS = [
  "meetingTitle", "startsAt", "title", "join", "share", "recording", "roomPanel", "sharedScreen",
  "handRaised", "micIsOff", "youSuffix", "mic", "camera", "devices", "hand", "aiCopilot", "captions",
  "stopRecording", "record", "more", "reactionThumbsUp", "adjustView", "controlBarAutoHide", "leave",
  "devicesSettingsTitle", "deviceMic", "deviceCamera", "deviceSpeaker", "chat", "participants", "people", "addNote", "recordingsTab",
  "insightsTab", "notes", "transcriptTab", "actionsTab", "aiSummary", "summaryEmpty", "notesInputLabel", "notesPlaceholder",
  "chatPlaceholder", "recordingsEmpty", "uniworkAi", "betaLabel", "summarizing", "regenerateSummary", "generateSummary",
  "askAboutMeeting", "comingSoon", "createTasksInUniwork", "recordConfirmTitle", "recordConfirm", "confirmStartRecording",
  "leaveConfirmTitle", "leaveConfirm", "confirmLeave", "status_SCHEDULED", "status_IN_PROGRESS",
];

const EMAIL_PREVIEW_KEYS = [
  "title", "compose_label", "labels_rules", "labels_section", "labels_sync_hint", "labels_show_more", "labels_show_less",
  "accounts", "no_accounts", "add_account", "connect_prompt", "account_menu", "account_menu_broken", "account_menu_needs_reconnect",
  "search_placeholder", "search_label", "search_clear", "search_empty", "refresh", "last_sync", "list_count",
  "has_attachments", "attachment_untitled", "attachments_count", "download_named", "no_subject", "to_recipient", "conversation_count", "select_thread",
  "folders", "folders_nav", "folder_menu", "filters", "empty", "shortcuts", "bulk", "snooze", "compose", "ai", "ai_title", "coming_soon",
  "reply", "reply_all", "forward", "restore_inbox", "star", "unstar", "archive", "trash", "not_spam", "report_spam",
  "thread_toolbar", "back_to_list_shortcut", "archive_shortcut", "trash_shortcut", "mark_unread_shortcut", "star_shortcut", "more_actions",
  "disconnect", "disconnect_named", "disconnect_confirm_title", "disconnect_confirm_body", "reconnect",
  "trusted_senders", "trusted_senders_description", "trusted_senders_empty", "trusted_senders_empty_hint", "trusted_senders_remove",
];

/** Public pages receive only the dictionaries their rendered previews need. */
export const loadMarketingDictionary = cache(async (locale: SupportedLocale, path = "/"): Promise<Record<string, unknown>> => {
  const dictionary = await loadDictionary(locale);
  const settings = dictionary.settings as { preferences?: Record<string, unknown> };
  const topbar = dictionary.topbar as Record<string, unknown>;
  const tasks = dictionary.tasks as Record<string, unknown>;
  const projects = dictionary.projects as Record<string, unknown>;
  const workspace = dictionary.workspace as Record<string, unknown>;
  const office = dictionary.office as { desktop: { install: Record<string, unknown> } };
  const landing = dictionary.landing as Record<string, unknown>;
  const home = dictionary.home as { greeting: Record<string, string>; headline: Record<string, string>; start: Record<string, string>; inbox: Record<string, string> };
  const meetings = dictionary.meetings as Record<string, unknown>;
  const governance = meetings.governance as Record<string, unknown>;
  const ai = dictionary.ai as Record<string, string>;
  const email = dictionary.email_hub as Record<string, unknown>;
  const preview = path === "/" || path.startsWith("/features/");
  const appPage = path === "/apps" || path.startsWith("/apps/");
  const lean = ["/request-demo", "/about", "/security", "/changelog"].includes(path) || path.startsWith("/learn/") || appPage;
  // `apps` rides on every lean page: the header's Apps menu reads it.
  const publicLanding = lean ? {
    ...Object.fromEntries(["nav", "cta", "footer", "final", "productPages", "catalog", "solutions", "studio", "workforce", "businessOs", "meetings", "demo", "apps"].map(key => [key, landing[key]])),
    office: path === "/apps/office" ? landing.office : { editions: (landing.office as Record<string, unknown>).editions },
    ...(path === "/apps/unichat" ? { unichat: landing.unichat } : {}),
  } : landing;
  return {
    landing: publicLanding, changelog: path === "/" || path === "/changelog" ? dictionary.changelog : { title: (dictionary.changelog as Record<string, unknown>).title }, marketingSeo: dictionary.marketingSeo,
    office: { desktop: { install: office.desktop.install } },
    common: dictionary.common, nav: dictionary.nav,
    ...(preview ? {
      home: { greeting: home.greeting, headline: { clear: home.headline.clear }, start: home.start, inbox: { empty_description: home.inbox.empty_description } },
      meetings: {
        ...Object.fromEntries(Object.entries(meetings).filter(([key]) => MEETING_PREVIEW_KEYS.includes(key) || key.startsWith("roomPeopleView_") || key.startsWith("createTasksInUniwork_"))),
        governance: { motionsTab: governance.motionsTab, motionsEmpty: governance.motionsEmpty },
      },
      ai,
      chat: dictionary.chat,
      myTasks: dictionary.myTasks,
      people: dictionary.people,
      calendar: dictionary.calendar,
      editor: dictionary.editor,
      documents: dictionary.documents,
    } : {}),
    ...(preview ? { email_hub: Object.fromEntries(EMAIL_PREVIEW_KEYS.map(key => [key, email[key]])) } : {}),
    tasks: {
      title: tasks.title, status: tasks.status, priority: tasks.priority, comments: tasks.comments,
      ...Object.fromEntries(["backlog", "todo", "in_progress", "in_review", "done", "blocked"].map(key => [`status_${key}`, tasks[`status_${key}`]])),
      unassigned: tasks.unassigned, priority_none: tasks.priority_none,
      card: { updated_ago: (tasks.card as Record<string, unknown>).updated_ago },
      surface: Object.fromEntries(["empty_column", "column_menu"].map(key => [key, (tasks.surface as Record<string, unknown>)[key]])),
    },
    projects: preview ? projects : { status: projects.status, priority: projects.priority },
    workspace: {
      members: workspace.members,
      ...Object.fromEntries(Object.entries(workspace).filter(([key]) => key.startsWith("invite_recipient_count") || key.startsWith("invite_invalid_summary") || ["invite_recipients_empty", "invite_invalid_email"].includes(key))),
    },
    topbar: { theme: topbar.theme, language: topbar.language },
    settings: { preferences: Object.fromEntries(["themeLight", "themeDark", "themeSystem", "languageVi", "languageEn"].map(key => [key, settings.preferences?.[key]])) },
  };
});
