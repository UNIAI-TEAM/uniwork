import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import { aptInstallCommands, aptQuickInstallCommand, aptScriptInstallCommand } from "@uniwork/core/office";
import { AptCode } from "./apt-code";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function render(command: string) {
  const container = document.createElement("div");
  act(() => { createRoot(container).render(createElement(AptCode, { command })); });
  return container;
}
/** Each place a line may break, as "end of the line | start of the next". */
const breaks = (container: HTMLElement) => [...container.querySelectorAll("wbr")].map((wbr) => `${wbr.previousElementSibling?.textContent}|${wbr.nextElementSibling?.textContent}`);

describe("the apt command text", () => {
  const commands = [aptScriptInstallCommand("beta"), aptScriptInstallCommand("stable"), aptQuickInstallCommand("dev"), aptQuickInstallCommand("stable"), aptInstallCommands("beta").join("\n")];

  it.each(commands)("keeps the copied text byte-identical: %s", (command) => {
    expect(render(command).querySelector("code")?.textContent).toBe(command);
  });

  it("breaks only after a path name's \"/\", never inside \"://\" or after a leading \"/\"", () => {
    expect(breaks(render(aptQuickInstallCommand("beta")))).toEqual([
      "/tmp/|uniwork-office.deb",
      "https://uniworkos.com/|downloads/",
      "downloads/|office/",
      "office/|apt/",
      "apt/|latest/",
      "latest/|beta/",
      "beta/|uniwork-office_amd64.deb",
      "/tmp/|uniwork-office.deb",
    ]);
    expect(breaks(render("sudo tee /etc/apt/sources.list.d/uniwork-office.sources > /dev/null"))).toEqual([
      "/etc/|apt/", "apt/|sources.list.d/", "sources.list.d/|uniwork-office.sources", "/dev/|null",
    ]);
  });

  it("holds a flag, a file name with hyphens and a URL host whole, and leaves the spaces to wrap at", () => {
    const container = render(aptScriptInstallCommand("beta"));
    const tokens = [...container.querySelectorAll(".apt-tok")].map((token) => token.textContent);
    for (const whole of ["-fsSL", "-s", "--", "beta", "sudo", "sh"]) expect(tokens).toContain(whole);
    expect(tokens).toContain("https://uniworkos.com/");
    // Spaces sit between the nowrap spans, not inside them, and a newline stays a newline.
    expect([...container.querySelectorAll(".apt-tok")].every((token) => !/\s/.test(token.textContent ?? ""))).toBe(true);
    expect(render("a\nb").querySelector("code")?.textContent).toBe("a\nb");
  });
});
