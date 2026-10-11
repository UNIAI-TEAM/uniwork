"use client";

import { useState, type ComponentProps } from "react";
import { Eye, EyeOff } from "lucide-react";
import { useTranslation } from "react-i18next";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@uniwork/ui/components/ui/input-group";

/** A password input with a show/hide toggle; every other prop goes to the input. */
export function PasswordInput(props: Omit<ComponentProps<"input">, "type">) {
  const { t } = useTranslation();
  const [shown, setShown] = useState(false);
  return (
    <InputGroup>
      <InputGroupInput {...props} type={shown ? "text" : "password"} />
      <InputGroupAddon align="inline-end">
        <InputGroupButton
          size="icon-xs"
          aria-pressed={shown}
          aria-label={shown ? t("common.hide_password") : t("common.show_password")}
          onClick={() => setShown((v) => !v)}
        >
          {shown ? <EyeOff aria-hidden /> : <Eye aria-hidden />}
        </InputGroupButton>
      </InputGroupAddon>
    </InputGroup>
  );
}
