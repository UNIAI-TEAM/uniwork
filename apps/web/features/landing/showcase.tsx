"use client";
import { BookOpen, Bot, Building2, CalendarDays, CircleCheck, ClipboardCheck, Columns3, FileText, FolderKanban, House, Mail, MessageSquare, ScrollText, Sparkles, Video, Workflow, Zap } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { featureCopyPrefix, previewKind } from "./feature-page-catalog";

export const PRODUCT_GROUPS = [
  { key: "work", icon: FolderKanban },
  { key: "communication", icon: MessageSquare },
  { key: "results", icon: ClipboardCheck },
  { key: "knowledge", icon: BookOpen },
  { key: "ai", icon: Sparkles },
  { key: "organization", icon: Building2 },
] as const;
type FeatureGroup = (typeof PRODUCT_GROUPS)[number]["key"];
function catalogItem<const Key extends string>(key: Key, group: FeatureGroup, icon: LucideIcon, anchor: string, status: "demo" | "partial" | "planned") {
  return { key, group, icon, anchor, status, label: `landing.catalog.features.${key}.label`, description: `landing.catalog.features.${key}.description`, availability: `landing.catalog.features.${key}.availability` };
}

/** Navigation breadth follows the reference; availability follows verified source. */
export const PRODUCT_FEATURES = [
  { key: "dashboard", group: "work", status: "demo", icon: House, label: "landing.lovable.dashboard", anchor: "tong-quan", description: "landing.lovable.dashboardSub", availability: "landing.lovable.sample" },
  { key: "tasks", group: "work", status: "demo", icon: Columns3, label: "landing.explorer.tasks", anchor: "du-an", description: "landing.workspace.tasksDescription", availability: "landing.discovery.search" },
  catalogItem("projects", "work", FolderKanban, "du-an-tong-quan", "demo"),
  { key: "today", group: "work", status: "demo", icon: House, label: "landing.updates.homeTab", anchor: "daily-tools", description: "landing.workspace.todayDescription", availability: "landing.updates.homeAvailability" },
  catalogItem("calendar", "work", CalendarDays, "lich-lam-viec", "planned"),
  catalogItem("workflows", "work", Workflow, "quy-trinh", "planned"),
  { key: "meetings", group: "communication", status: "demo", icon: Video, label: "landing.meeting.online", anchor: "hop", description: "landing.workspace.meetingsDescription", availability: "landing.updates.meetingAvailability" },
  { key: "chat", group: "communication", status: "demo", icon: MessageSquare, label: "landing.explorer.chat", anchor: "trao-doi", description: "landing.workspace.chatDescription", availability: "landing.updates.chatAvailability" },
  { key: "email", group: "communication", status: "demo", icon: Mail, label: "landing.updates.emailTab", anchor: "email", description: "landing.workspace.emailDescription", availability: "landing.updates.emailAvailability" },
  catalogItem("outputs", "results", ClipboardCheck, "ket-qua", "planned"),
  catalogItem("documents", "results", FileText, "tai-lieu", "planned"),
  catalogItem("approvals", "results", CircleCheck, "phe-duyet", "planned"),
  catalogItem("knowledge", "knowledge", BookOpen, "tri-thuc", "planned"),
  { key: "ask", group: "ai", status: "demo", icon: Sparkles, label: "landing.studio.askTab", anchor: "hoi-uni", description: "landing.workspace.askDescription", availability: "landing.studio.askGuardrail" },
  catalogItem("agents", "ai", Bot, "quan-ly-agent", "partial"),
  catalogItem("automation", "ai", Zap, "tu-dong-hoa", "planned"),
  catalogItem("organization", "organization", Building2, "to-chuc", "demo"),
  catalogItem("audit", "organization", ScrollText, "nhat-ky", "demo"),
] as const;

/** Keep the original public directory while synchronizing the complete V2 demo. */
const PREVIEW_FEATURES = [
  ...PRODUCT_FEATURES,
  catalogItem("ai-brain", "ai", Sparkles, "ai-brain", "planned"),
  catalogItem("skills", "ai", Zap, "ky-nang-ai", "planned"),
  catalogItem("work-catalog", "ai", ClipboardCheck, "work-catalog", "planned"),
  catalogItem("decisions", "results", CircleCheck, "quyet-dinh", "planned"),
  catalogItem("decision-history", "results", ScrollText, "lich-su-quyet-dinh", "planned"),
  catalogItem("ai-market", "ai", Bot, "ai-market", "planned"),
  catalogItem("reports", "organization", Columns3, "bao-cao", "planned"),
] as const;
export const DEMO_FEATURES = PREVIEW_FEATURES.map(item => ({
  ...item,
  label: ["ai-brain", "skills", "work-catalog", "decisions", "decision-history", "ai-market", "reports"].includes(item.key) ? `landing.revision.features.${item.key}.label` : item.label,
  description: `${featureCopyPrefix(item.key)}.description`,
  availability: "landing.revision.referenceScope",
  status: previewKind(item.key),
}));
export type ProductFeature = (typeof DEMO_FEATURES)[number]["key"];
