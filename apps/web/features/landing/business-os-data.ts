import { BarChart3, BookOpen, Bot, BrainCircuit, Building2, Calculator, Cloud, Database, FileCheck2, FileSignature, FileSpreadsheet, FileText, FolderKanban, Globe, GraduationCap, LayoutGrid, Mail, MessageSquare, Network, Presentation, Receipt, Scale, Server, ShieldCheck, Sparkles, Users, Video } from "lucide-react";
import type { LucideIcon } from "lucide-react";

type CapabilityStatus = "available" | "configured" | "foundation" | "development" | "planned";
type Capability = { key: string; icon: LucideIcon; status?: CapabilityStatus };
type BusinessOsLayer = {
  key: string;
  number: number;
  icon: LucideIcon;
  status: CapabilityStatus;
  groups: { key: string; items: Capability[] }[];
};

/** The supplied architecture is a product direction; status follows develop. */
export const BUSINESS_OS_LAYERS: BusinessOsLayer[] = [
  {
    key: "ai", number: 4, icon: BrainCircuit, status: "foundation",
    groups: [{ key: "intelligence", items: [
      { key: "gateway", icon: Sparkles, status: "configured" },
      { key: "context", icon: Database, status: "foundation" },
      { key: "graph", icon: Network, status: "planned" },
      { key: "memory", icon: BookOpen, status: "planned" },
      { key: "skills", icon: GraduationCap, status: "planned" },
      { key: "workforce", icon: Bot, status: "foundation" },
      { key: "executive", icon: BarChart3, status: "planned" },
    ] }],
  },
  {
    key: "core", number: 3, icon: LayoutGrid, status: "available",
    groups: [{ key: "workspace", items: [
      { key: "organization", icon: Building2 },
      { key: "people", icon: Users },
      { key: "projects", icon: FolderKanban },
      { key: "tasks", icon: FileCheck2 },
      { key: "chat", icon: MessageSquare, status: "configured" },
      { key: "meetings", icon: Video, status: "configured" },
      { key: "email", icon: Mail, status: "configured" },
      { key: "knowledge", icon: BookOpen, status: "planned" },
      { key: "outputs", icon: FileText, status: "planned" },
      { key: "integrations", icon: Network, status: "planned" },
    ] }],
  },
  {
    key: "office", number: 2, icon: FileText, status: "development",
    groups: [{ key: "productivity", items: [
      { key: "word", icon: FileText },
      { key: "excel", icon: FileSpreadsheet },
      { key: "powerpoint", icon: Presentation },
      { key: "pdf", icon: FileCheck2 },
      { key: "templates", icon: LayoutGrid },
      { key: "collaboration", icon: Users },
      { key: "aiDocument", icon: Sparkles },
    ] }],
  },
  {
    key: "services", number: 1, icon: Building2, status: "planned",
    groups: [
      { key: "business", items: [
        { key: "company", icon: Building2 },
        { key: "tax", icon: Receipt },
        { key: "accounting", icon: Calculator },
        { key: "trademark", icon: ShieldCheck },
        { key: "compliance", icon: Scale },
      ] },
      { key: "infrastructure", items: [
        { key: "domain", icon: Globe },
        { key: "website", icon: LayoutGrid },
        { key: "businessEmail", icon: Mail },
        { key: "hosting", icon: Server },
        { key: "cloud", icon: Cloud },
        { key: "signature", icon: FileSignature },
        { key: "invoice", icon: Receipt },
        { key: "contract", icon: FileCheck2 },
      ] },
    ],
  },
];
