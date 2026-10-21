// Settings › About (audit R3): which UniChat this is — the store version, the
// native build, the EAS Update channel and the update it runs — so a person
// reporting a problem and support reading a crash report name the same
// build. One tap copies the full line (with the whole update id) for support.
import * as Clipboard from "expo-clipboard";
import { Fragment } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, View } from "react-native";
import { Separator } from "@/components/ui/separator";
import { Text } from "@/components/ui/text";
import { buildInfo } from "@/data/build-info";
import { toast } from "@/data/stores/toast-store";
import { shortUpdateId } from "@/lib/build-info";
import { SettingsSection } from "./settings-section";

export function AboutSection() {
  const { t } = useTranslation();
  const info = buildInfo();
  const rows: [label: string, value: string][] = [
    [t("mobile.about.version"), info.version],
    [t("mobile.about.build"), info.build || t("mobile.about.none")],
    [t("mobile.about.channel"), info.channel || t("mobile.about.none")],
    [t("mobile.about.update"), info.updateId ? shortUpdateId(info.updateId) : t("mobile.about.embedded")],
  ];
  const copy = async () => {
    const details = `UniChat ${info.version} (${info.build || "-"}) · ${info.os} · ${info.channel || "-"} · ${info.updateId ?? "embedded"} · ${info.runtimeVersion || "-"}`;
    await Clipboard.setStringAsync(details);
    toast.success(t("mobile.about.copied"));
  };
  return (
    <SettingsSection title={t("mobile.about.title")}>
      {rows.map(([label, value], index) => (
        <Fragment key={label}>
          {index > 0 ? <Separator className="ml-4 w-auto" /> : null}
          <View accessible accessibilityLabel={`${label}: ${value}`} className="min-h-[48px] flex-row items-center justify-between gap-3 px-4 py-2.5">
            <Text className="text-body text-foreground">{label}</Text>
            <Text selectable numberOfLines={1} className="shrink text-right text-body text-muted-foreground">
              {value}
            </Text>
          </View>
        </Fragment>
      ))}
      <Separator className="ml-4 w-auto" />
      <Pressable onPress={() => void copy()} accessibilityRole="button" testID="about-copy" className="min-h-[48px] justify-center px-4 py-2.5 active:bg-secondary">
        <Text className="text-body font-medium text-primary">{t("mobile.about.copy")}</Text>
      </Pressable>
    </SettingsSection>
  );
}
