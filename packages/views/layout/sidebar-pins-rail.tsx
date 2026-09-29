"use client";

import { Pin } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { TaskPin } from "@uniwork/core/types/task-view";
import { IconTile } from "@uniwork/ui/components/common/icon-tile";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@uniwork/ui/components/ui/dropdown-menu";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@uniwork/ui/components/ui/sidebar";
import type { StatusCatalog } from "../tasks/pickers/status-catalog";
import { AppLink } from "../navigation";
import { usePinItem } from "./sidebar-pin-row";

function PinMenuItem({
  pin,
  wsId,
  href,
  current,
  statuses,
  onNavigate,
}: {
  pin: TaskPin;
  wsId: string;
  href: string;
  current: boolean;
  statuses: StatusCatalog;
  onNavigate: () => void;
}) {
  const item = usePinItem(pin, wsId, statuses);
  if (item.state !== "ready") return null;
  return (
    <DropdownMenuItem
      render={<AppLink href={href} aria-current={current ? "page" : undefined} onClick={onNavigate} />}
      className={current ? "bg-accent/60 font-medium" : undefined}
    >
      {item.icon}
      <span className="truncate">{item.label}</span>
    </DropdownMenuItem>
  );
}

/**
 * The icon rail has no room for names, so the pins sit behind one counted
 * button whose menu lists them; the expanded group is hidden there.
 */
export function SidebarPinsRail({
  pins,
  wsId,
  hrefOf,
  pathname,
  statuses,
  onNavigate,
}: {
  pins: TaskPin[];
  wsId: string;
  hrefOf: (pin: TaskPin) => string;
  pathname: string;
  statuses: StatusCatalog;
  onNavigate: () => void;
}) {
  const { t } = useTranslation();
  const label = t("nav.pinned_count", { count: pins.length });
  const onPinnedPage = pins.some((pin) => pathname === hrefOf(pin));

  return (
    <SidebarGroup className="hidden px-0 py-1 group-data-[collapsible=icon]:flex">
      <SidebarGroupContent>
        <SidebarMenu>
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <SidebarMenuButton
                    aria-label={label}
                    tooltip={label}
                    isActive={onPinnedPage}
                    className="isolate h-9 overflow-visible rounded-md text-muted-foreground hover:not-data-active:bg-sidebar-accent/70 data-active:bg-sidebar-accent data-active:text-sidebar-accent-foreground"
                  />
                }
              >
                <span aria-hidden className="relative shrink-0 overflow-visible!">
                  <IconTile icon={Pin} size="xs" variant="soft" className="[&_svg]:size-3 [&_svg]:stroke-[2.25]" />
                  <span
                    className="absolute -top-1.5 -right-1.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-primary px-0.5 text-micro leading-none text-primary-foreground"
                  >
                    {pins.length}
                  </span>
                </span>
              </DropdownMenuTrigger>
              <DropdownMenuContent side="right" align="start" className="w-64">
                <DropdownMenuGroup>
                  <DropdownMenuLabel className="text-caption text-muted-foreground">{t("nav.pinned")}</DropdownMenuLabel>
                  {pins.map((pin) => {
                    const href = hrefOf(pin);
                    return (
                      <PinMenuItem
                        key={pin.id}
                        pin={pin}
                        wsId={wsId}
                        href={href}
                        current={pathname === href}
                        statuses={statuses}
                        onNavigate={onNavigate}
                      />
                    );
                  })}
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}
