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
function catalogItem<const Key extends string>(key: Key, group: FeatureGroup, icon: LucideIcon, anchor: string) {
  return { key, group, icon, anchor, label: `landing.catalog.features.${key}.label`, description: `landing.catalog.features.${key}.description` };
}

/** Product areas follow the approved reference; preview labels describe local behavior. */
const REFERENCE_FEATURES = [
  { key: "dashboard", group: "work", icon: House, label: "landing.lovable.dashboard", anchor: "tong-quan", description: "landing.lovable.dashboardSub" },
  { key: "tasks", group: "work", icon: Columns3, label: "landing.explorer.tasks", anchor: "du-an", description: "landing.workspace.tasksDescription" },
  catalogItem("projects", "work", FolderKanban, "du-an-tong-quan"),
  { key: "today", group: "work", icon: House, label: "landing.updates.homeTab", anchor: "daily-tools", description: "landing.workspace.todayDescription" },
  catalogItem("calendar", "work", CalendarDays, "lich-lam-viec"),
  catalogItem("workflows", "work", Workflow, "quy-trinh"),
  { key: "meetings", group: "communication", icon: Video, label: "landing.meeting.online", anchor: "hop", description: "landing.workspace.meetingsDescription" },
  { key: "chat", group: "communication", icon: MessageSquare, label: "landing.explorer.chat", anchor: "trao-doi", description: "landing.workspace.chatDescription" },
  { key: "email", group: "communication", icon: Mail, label: "landing.updates.emailTab", anchor: "email", description: "landing.workspace.emailDescription" },
  catalogItem("outputs", "results", ClipboardCheck, "ket-qua"),
  catalogItem("documents", "results", FileText, "tai-lieu"),
  catalogItem("approvals", "results", CircleCheck, "phe-duyet"),
  catalogItem("knowledge", "knowledge", BookOpen, "tri-thuc"),
  { key: "ask", group: "ai", icon: Sparkles, label: "landing.studio.askTab", anchor: "hoi-uni", description: "landing.workspace.askDescription" },
  catalogItem("agents", "ai", Bot, "quan-ly-agent"),
  catalogItem("automation", "ai", Zap, "tu-dong-hoa"),
  catalogItem("organization", "organization", Building2, "to-chuc"),
  catalogItem("audit", "organization", ScrollText, "nhat-ky"),
  catalogItem("ai-brain", "ai", Sparkles, "ai-brain"),
  catalogItem("skills", "ai", Zap, "ky-nang-ai"),
  catalogItem("work-catalog", "ai", ClipboardCheck, "work-catalog"),
  catalogItem("decisions", "results", CircleCheck, "quyet-dinh"),
  catalogItem("decision-history", "results", ScrollText, "lich-su-quyet-dinh"),
  catalogItem("ai-market", "ai", Bot, "ai-market"),
  catalogItem("reports", "organization", Columns3, "bao-cao"),
] as const;
export const PRODUCT_FEATURES = REFERENCE_FEATURES.map(item => ({
  ...item,
  label: ["ai-brain", "skills", "work-catalog", "decisions", "decision-history", "ai-market", "reports"].includes(item.key) ? `landing.revision.features.${item.key}.label` : item.label,
  description: `${featureCopyPrefix(item.key)}.description`,
  availability: "landing.revision.referenceScope",
  status: previewKind(item.key),
}));
export type ProductFeature = (typeof PRODUCT_FEATURES)[number]["key"];
