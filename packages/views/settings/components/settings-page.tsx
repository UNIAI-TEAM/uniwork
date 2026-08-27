"use client";

import { Plug, Settings, SlidersHorizontal, User, Users } from "lucide-react";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@uniwork/ui/components/ui/tabs";
import { useIsMobile } from "@uniwork/ui/hooks/use-mobile";
import { CollapsedNavTrigger } from "../../layout/page-header";
import { useWorkspace } from "../../layout/workspace-context";
import { useNavigation } from "../../navigation";
import { AccountTab } from "./account-tab";
import { IntegrationsTab } from "./integrations-tab";
import { MembersTab } from "./members-tab";
import { PreferencesTab } from "./preferences-tab";
import { WorkspaceTab } from "./workspace-tab";

const ACCOUNT_TAB_KEYS = ["profile", "preferences"] as const;
const ACCOUNT_TAB_ICONS = {
  profile: User,
  preferences: SlidersHorizontal,
} as const;

const WORKSPACE_TAB_KEYS = ["general", "members", "integrations"] as const;
const WORKSPACE_TAB_VALUES = {
  general: "workspace",
  members: "members",
  integrations: "integrations",
} as const;
const WORKSPACE_TAB_ICONS = {
  general: Settings,
  members: Users,
  integrations: Plug,
} as const;

const DEFAULT_TAB = "profile";
const TAB_QUERY_KEY = "tab";

// Line-variant TabsTrigger zeroes active background; force surface-selected
// so the active item reads as a pill in the settings nav.
const SETTINGS_TAB_TRIGGER_CLASS =
  "h-8 shrink-0 justify-start px-2.5 hover:bg-surface-hover data-active:!bg-surface-selected data-active:!text-surface-selected-foreground data-active:hover:!bg-surface-selected md:!w-full md:px-2 md:after:hidden";

export function SettingsPage() {
  const { t } = useTranslation(undefined, { keyPrefix: "settings" });
  const { workspace } = useWorkspace();
  const navigation = useNavigation();
  const isMobile = useIsMobile();

  const validTabs = useMemo(
    () =>
      new Set<string>([
        ...ACCOUNT_TAB_KEYS,
        ...WORKSPACE_TAB_KEYS.map((key) => WORKSPACE_TAB_VALUES[key]),
      ]),
    [],
  );

  const tabFromUrl = navigation.searchParams.get(TAB_QUERY_KEY);
  const activeTab =
    tabFromUrl && validTabs.has(tabFromUrl) ? tabFromUrl : DEFAULT_TAB;

  const handleTabChange = (next: string) => {
    const params = new URLSearchParams(navigation.searchParams);
    params.set(TAB_QUERY_KEY, next);
    navigation.replace(`${navigation.pathname}?${params.toString()}`);
  };

  return (
    <Tabs
      value={activeTab}
      onValueChange={handleTabChange}
      orientation={isMobile ? "horizontal" : "vertical"}
      className="flex min-h-0 flex-1 flex-col gap-0 overflow-y-auto md:flex-row md:overflow-hidden"
    >
      <div className="shrink-0 overflow-x-auto border-b border-border p-2 md:w-56 md:overflow-y-auto md:border-r md:border-b-0 md:p-4">
        <div className="flex items-center md:mb-4">
          <CollapsedNavTrigger />
          <h1 className="sr-only text-body font-semibold md:not-sr-only md:px-2">{t("page.title")}</h1>
        </div>
        <TabsList
          variant="line"
          className="flex w-max min-w-full flex-row items-center gap-1 p-0 md:w-full md:flex-col md:items-stretch"
        >
          <span className="hidden px-2 pt-2 pb-1 text-caption font-medium text-muted-foreground md:block">
            {t("page.my_account")}
          </span>
          {ACCOUNT_TAB_KEYS.map((key) => {
            const Icon = ACCOUNT_TAB_ICONS[key];
            return (
              <TabsTrigger key={key} value={key} className={SETTINGS_TAB_TRIGGER_CLASS}>
                <Icon className="h-4 w-4" aria-hidden />
                {t(`page.tabs.${key}`)}
              </TabsTrigger>
            );
          })}

          <span className="hidden truncate px-2 pt-4 pb-1 text-caption font-medium text-muted-foreground md:block">
            {workspace.name}
          </span>
          {WORKSPACE_TAB_KEYS.map((key) => {
            const Icon = WORKSPACE_TAB_ICONS[key];
            return (
              <TabsTrigger
                key={key}
                value={WORKSPACE_TAB_VALUES[key]}
                className={SETTINGS_TAB_TRIGGER_CLASS}
              >
                <Icon className="h-4 w-4" aria-hidden />
                {t(`page.tabs.${key}`)}
              </TabsTrigger>
            );
          })}
        </TabsList>
      </div>

      <div className="min-w-0 flex-1 md:overflow-y-auto">
        <div className="mx-auto w-full max-w-3xl p-4 sm:p-6 md:p-8">
          <TabsContent value="profile">
            <AccountTab />
          </TabsContent>
          <TabsContent value="preferences">
            <PreferencesTab />
          </TabsContent>
          <TabsContent value="workspace">
            <WorkspaceTab />
          </TabsContent>
          <TabsContent value="members">
            <MembersTab />
          </TabsContent>
          <TabsContent value="integrations">
            <IntegrationsTab />
          </TabsContent>
        </div>
      </div>
    </Tabs>
  );
}
