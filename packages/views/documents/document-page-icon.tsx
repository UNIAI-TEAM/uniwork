"use client";

import { useState } from "react";
import { SmilePlus } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@uniwork/ui/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@uniwork/ui/components/ui/tooltip";

const EMOJIS = [
  "📝", "📄", "📚", "📌", "📎", "🗂️", "📋", "📅",
  "💡", "🎯", "✅", "🚀", "⭐", "✨", "💬", "🔍",
  "💼", "🛠️", "⚙️", "🔑", "🔒", "🧭", "🗺️", "🏠",
  "🎨", "🎬", "🎵", "📷", "💻", "📱", "📊", "📈",
  "🌱", "🌿", "🌻", "🌈", "☀️", "🌙", "🔥", "⚡",
  "☕", "🍀", "🎉", "🎁", "❤️", "🤝", "👥", "😊",
] as const;

export function DocumentPageIcon({ icon, onChange }: { icon: string; onChange: (icon: string) => void }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const label = t(icon ? "documents.page_ui.change_icon" : "documents.page_ui.add_icon");
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger render={
          <PopoverTrigger render={
            <Button type="button" variant="ghost" aria-label={label}
              className={icon
                ? "mb-4 size-16 justify-center p-0 text-display"
                : "mb-3 h-9 px-2 text-caption text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 [@media(pointer:coarse)]:opacity-100"} />
          }>
            {icon ? <span aria-hidden>{icon}</span> : <><SmilePlus aria-hidden className="size-4" />{label}</>}
          </PopoverTrigger>
        } />
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
      <PopoverContent align="start" className="w-80 max-w-[calc(100vw-2rem)] p-3" aria-label={t("documents.page_ui.icon_picker")}>
        <div className="grid grid-cols-8 gap-1 [@media(pointer:coarse)]:grid-cols-6">
          {EMOJIS.map((emoji) => (
            <Button key={emoji} type="button" variant="ghost" size="icon" className="text-title-lg"
              aria-label={t("documents.page_ui.choose_icon", { emoji })}
              onClick={() => { onChange(emoji); setOpen(false); }}>
              <span aria-hidden>{emoji}</span>
            </Button>
          ))}
        </div>
        {icon ? <Button type="button" variant="ghost" className="justify-start text-muted-foreground"
          onClick={() => { onChange(""); setOpen(false); }}>{t("documents.page_ui.remove_icon")}</Button> : null}
      </PopoverContent>
    </Popover>
  );
}
