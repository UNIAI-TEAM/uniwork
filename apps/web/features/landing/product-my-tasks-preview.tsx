"use client";

import { useState, type ComponentProps } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import { ChevronDown } from "lucide-react";
import { useIsCompact } from "@uniwork/ui/hooks/use-mobile";
import { DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from "@uniwork/ui/components/ui/dropdown-menu";
import { ProductTaskBoard } from "./product-task-board";

export function ProductMyTasksPreview(props: ComponentProps<typeof ProductTaskBoard>) {
  const { t } = useTranslation();
  const [scope, setScope] = useState("assigned");
  const compact = useIsCompact();
  const tasks = scope === "all" ? props.tasks : props.tasks.filter(task => task.person === "Đ");
  const scopes = ["all", "assigned", "created", "involved"];
  return <ProductTaskBoard {...props} tasks={tasks} toolbarLeading={compact ? <DropdownMenu><DropdownMenuTrigger render={<Button variant="ghost" size="sm" />}>{t(`myTasks.scope.${scope}_label`)}<ChevronDown aria-hidden /></DropdownMenuTrigger><DropdownMenuContent><DropdownMenuRadioGroup value={scope} onValueChange={setScope}>{scopes.map(value => <DropdownMenuRadioItem key={value} value={value} disabled={value === "involved"}>{t(`myTasks.scope.${value}_label`)}</DropdownMenuRadioItem>)}</DropdownMenuRadioGroup></DropdownMenuContent></DropdownMenu> : <div className="product-my-tasks-scopes">{scopes.map(value => <Button key={value} variant={scope === value ? "secondary" : "ghost"} size="sm" aria-pressed={scope === value} disabled={value === "involved"} onClick={() => setScope(value)}>{t(`myTasks.scope.${value}_label`)}</Button>)}</div>} />;
}
