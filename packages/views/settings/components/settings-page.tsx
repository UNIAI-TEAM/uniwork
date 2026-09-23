"use client";

import {
  Bell,
  Building2,
  CreditCard,
  Keyboard,
  Network,
  Plug,
  ScrollText,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  User,
  Users,
  type LucideIcon,
} from "lucide-react";
import { Suspense, lazy, type ComponentType } from "react";
import { useTranslation } from "react-i18next";
import { useAuditPermissions, useBillingPermissions } from "@uniwork/core/permissions";
import { useMyMembership } from "@uniwork/core/workspaces";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@uniwork/ui/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@uniwork/ui/components/ui/tabs";
import { useIsMobile } from "@uniwork/ui/hooks/use-mobile";
import { CollectionPageHeader } from "../../layout/collection-page";
import { moduleTone } from "../../layout/module-tones";
import { useWorkspace } from "../../layout/workspace-context";
import { useNavigation } from "../../navigation";
import { AccountTab } from "./account-tab";
import { SettingsTabSkeleton } from "./settings-layout";

// Only the open panel is mounted, so every tab but the default one is a
// chunk fetched on the click that reveals it; the settings route stays inside
// its bundle ceiling.
const SecurityTab = lazy(() => import("./security-tab").then((m) => ({ default: m.SecurityTab })));
const AiTab = lazy(() => import("./ai-tab").then((m) => ({ default: m.AiTab })));
const AuditTab = lazy(() => import("./audit-tab").then((m) => ({ default: m.AuditTab })));
const BillingTab = lazy(() => import("./billing-tab").then((m) => ({ default: m.BillingTab })));
const DepartmentsTab = lazy(() => import("./departments-tab").then((m) => ({ default: m.DepartmentsTab })));
const KeyboardShortcutsTab = lazy(() => import("./keyboard-shortcuts-tab").then((m) => ({ default: m.KeyboardShortcutsTab })));
const IntegrationsTab = lazy(() => import("./integrations-tab").then((m) => ({ default: m.IntegrationsTab })));
const MembersTab = lazy(() => import("./members-tab").then((m) => ({ default: m.MembersTab })));
const NotificationsTab = lazy(() => import("./notifications-tab").then((m) => ({ default: m.NotificationsTab })));
const OrganizationTab = lazy(() => import("./organization-tab").then((m) => ({ default: m.OrganizationTab })));
const PreferencesTab = lazy(() => import("./preferences-tab").then((m) => ({ default: m.PreferencesTab })));
const WorkspaceTab = lazy(() => import("./workspace-tab").then((m) => ({ default: m.WorkspaceTab })));

type Gate = "billing" | "audit" | "workspace_admin";

interface TabDef {
  /** The `?tab=` value; links and e2e specs point at these, so they never change. */
  value: string;
  /** Key under `settings.page.tabs`. */
  label: string;
  icon: LucideIcon;
  Panel: ComponentType;
  /** Hidden from the nav once the reader is known not to pass it. */
  gate?: Gate;
}

type GroupId = "account" | "organization" | "workspace";

/**
 * Three tiers, each holding only what belongs to it: the person, the company
 * (members, structure, the plan it pays for, its audit trail — all keyed by
 * organization), and the one workspace in view.
 */
const GROUPS: readonly { id: GroupId; tabs: readonly TabDef[] }[] = [
  {
    id: "account",
    tabs: [
      { value: "profile", label: "profile", icon: User, Panel: AccountTab },
      { value: "security", label: "security", icon: ShieldCheck, Panel: SecurityTab },
      { value: "preferences", label: "preferences", icon: SlidersHorizontal, Panel: PreferencesTab },
      { value: "notifications", label: "notifications", icon: Bell, Panel: NotificationsTab },
      { value: "shortcuts", label: "shortcuts", icon: Keyboard, Panel: KeyboardShortcutsTab },
    ],
  },
  {
    id: "organization",
    tabs: [
      { value: "organization", label: "organization", icon: Building2, Panel: OrganizationTab },
      { value: "departments", label: "departments", icon: Network, Panel: DepartmentsTab },
      { value: "billing", label: "billing", icon: CreditCard, Panel: BillingTab, gate: "billing" },
      { value: "audit", label: "audit", icon: ScrollText, Panel: AuditTab, gate: "audit" },
    ],
  },
  {
    id: "workspace",
    tabs: [
      { value: "workspace", label: "workspace", icon: Settings, Panel: WorkspaceTab },
      { value: "members", label: "members", icon: Users, Panel: MembersTab },
      { value: "integrations", label: "integrations", icon: Plug, Panel: IntegrationsTab },
      { value: "ai", label: "ai", icon: Sparkles, Panel: AiTab, gate: "workspace_admin" },
    ],
  },
];

const ALL_TABS = GROUPS.flatMap((group) => group.tabs);
const VALID_TABS = new Set(ALL_TABS.map((tab) => tab.value));
const DEFAULT_TAB = "profile";
const TAB_QUERY_KEY = "tab";
const ADMIN_ROLES = new Set(["owner", "admin"]);

// Line-variant TabsTrigger zeroes active background; force surface-selected
// so the active item reads as a pill in the settings nav.
const SETTINGS_TAB_TRIGGER_CLASS =
  "h-8 w-full shrink-0 justify-start px-2 hover:bg-surface-hover data-active:!bg-surface-selected data-active:!text-surface-selected-foreground data-active:hover:!bg-surface-selected after:hidden";

/**
 * Which gated tabs to hide. A tab stays listed while its permission is still
 * loading, so the nav never loses an item the reader turns out to have; a tab
 * reached by URL still renders its own forbidden state.
 */
function useHiddenGates(): Set<Gate> {
  const { workspace } = useWorkspace();
  const billing = useBillingPermissions(workspace.organization_id);
  const audit = useAuditPermissions(workspace.organization_id);
  const me = useMyMembership(workspace.id);
  const hidden = new Set<Gate>();
  if (!billing.isLoading && !billing.canView.allowed) hidden.add("billing");
  if (!audit.isLoading && !audit.canRead.allowed) hidden.add("audit");
  if (!me.isLoading && me.data && !ADMIN_ROLES.has(me.data.role)) hidden.add("workspace_admin");
  return hidden;
}

export function SettingsPage() {
  const { t } = useTranslation(undefined, { keyPrefix: "settings" });
  const { workspace } = useWorkspace();
  const navigation = useNavigation();
  const isMobile = useIsMobile();
  const hidden = useHiddenGates();

  const tabFromUrl = navigation.searchParams.get(TAB_QUERY_KEY);
  const activeTab = tabFromUrl && VALID_TABS.has(tabFromUrl) ? tabFromUrl : DEFAULT_TAB;

  const handleTabChange = (next: string) => {
    const params = new URLSearchParams(navigation.searchParams);
    params.set(TAB_QUERY_KEY, next);
    navigation.replace(`${navigation.pathname}?${params.toString()}`);
  };

  // The open tab is always listed, even when its gate would hide it: the
  // reader came here by URL and the nav should say where they are.
  const groups = GROUPS.map((group) => ({
    ...group,
    tabs: group.tabs.filter((tab) => !tab.gate || !hidden.has(tab.gate) || tab.value === activeTab),
  }));

  const scopeName: Record<GroupId, string | null> = {
    account: null,
    organization: workspace.organization_name,
    workspace: workspace.name,
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <CollectionPageHeader icon={Settings} tone={moduleTone("settings")} title={t("page.title")} />
      <Tabs
        value={activeTab}
        onValueChange={handleTabChange}
        orientation="vertical"
        className="flex min-h-0 flex-1 flex-col gap-0 md:flex-row"
      >
        {isMobile ? (
          <div className="shrink-0 border-b border-border px-4 py-2.5">
            <Select
              items={ALL_TABS.map((tab) => ({ value: tab.value, label: t(`page.tabs.${tab.label}`) }))}
              value={activeTab}
              onValueChange={(next) => {
                if (typeof next === "string") handleTabChange(next);
              }}
            >
              <SelectTrigger className="w-full" aria-label={t("page.section_picker")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {groups.map((group, index) => (
                  <SelectGroup key={group.id}>
                    {index > 0 ? <SelectSeparator /> : null}
                    <SelectLabel>{t(`page.groups.${group.id}`)}</SelectLabel>
                    {group.tabs.map((tab) => (
                      <SelectItem key={tab.value} value={tab.value}>
                        <tab.icon aria-hidden className="text-muted-foreground" />
                        {t(`page.tabs.${tab.label}`)}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : (
          <nav
            aria-label={t("page.nav_label")}
            className="w-60 shrink-0 overflow-y-auto border-r border-border px-3 py-4"
          >
            <TabsList variant="line" className="flex w-full flex-col items-stretch gap-0.5 p-0">
              {groups.map((group, index) => (
                <div key={group.id} className="contents">
                  <div className={index === 0 ? "px-2 pb-1.5" : "px-2 pt-5 pb-1.5"}>
                    <p className="text-caption font-semibold text-muted-foreground">{t(`page.groups.${group.id}`)}</p>
                    {scopeName[group.id] ? (
                      <p className="truncate text-caption text-faint-foreground" title={scopeName[group.id] ?? undefined}>
                        {scopeName[group.id]}
                      </p>
                    ) : null}
                  </div>
                  {group.tabs.map((tab) => (
                    <TabsTrigger key={tab.value} value={tab.value} className={SETTINGS_TAB_TRIGGER_CLASS}>
                      <tab.icon className="size-4" aria-hidden />
                      {t(`page.tabs.${tab.label}`)}
                    </TabsTrigger>
                  ))}
                </div>
              ))}
            </TabsList>
          </nav>
        )}

        <div className="min-h-0 min-w-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-3xl px-4 pt-6 pb-12 sm:px-6 md:px-8 md:pt-8 md:pb-16">
            {ALL_TABS.map(({ value, Panel }) => (
              <TabsContent key={value} value={value}>
                {value === DEFAULT_TAB ? (
                  <Panel />
                ) : (
                  <Suspense fallback={<SettingsTabSkeleton />}>
                    <Panel />
                  </Suspense>
                )}
              </TabsContent>
            ))}
          </div>
        </div>
      </Tabs>
    </div>
  );
}
