import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { RAIL_VAR_FALLBACK, StepSidebar } from "./step-sidebar";

initI18n();

describe("StepSidebar", () => {
  it("marks current step, lets only completed steps be clicked", () => {
    const onStepChange = vi.fn();
    render(<StepSidebar currentStep="workspace" onStepChange={onStepChange} />);
    const current = screen.getByText("Workspace").closest('[aria-current="step"]');
    expect(current).not.toBeNull();
    expect(screen.getByRole("button", { name: /Về bạn/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Tổ chức/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Mời đồng nghiệp/ })).toBeNull();
    screen.getByRole("button", { name: /Về bạn/ }).click();
    expect(onStepChange).toHaveBeenCalledWith("about_you");
  });
  it("locks rail when backDisabled", () => {
    render(<StepSidebar currentStep="workspace" onStepChange={() => {}} backDisabled />);
    expect(screen.queryByRole("button", { name: /Về bạn/ })).toBeNull();
  });
});

/**
 * Fallback của rail là hai giá trị hex chép tay — thứ duy nhất trong cây
 * onboarding không đến từ token. Nó chỉ sống đúng một frame (SSR + render đầu),
 * nên nếu lệch khỏi tokens.css thì không test nào khác nhìn thấy: rail chớp sai
 * màu một nhịp rồi tự sửa. Khoá nó lại ngay tại nguồn.
 */
describe("RAIL_VAR_FALLBACK bám theo tokens.css", () => {
  // Đi ngược lên tìm thay vì ghép đường dẫn tương đối: `import.meta.url` dưới
  // môi trường jsdom của vitest không phải scheme `file:`.
  const tokensPath = (() => {
    for (let dir = process.cwd(); dir !== dirname(dir); dir = dirname(dir)) {
      const candidate = join(dir, "packages/ui/styles/tokens.css");
      if (existsSync(candidate)) return candidate;
    }
    throw new Error("tokens.css not found");
  })();
  const css = readFileSync(tokensPath, "utf8");
  const readVar = (scope: RegExp, name: string) => {
    const block = css.match(scope)?.[0] ?? "";
    return block.match(new RegExp(`${name}:\\s*([^;]+);`))?.[1]?.trim();
  };

  it("--uw-rail-bg khớp giá trị ở :root", () => {
    expect(readVar(/:root\s*\{[\s\S]*?\n\}/, "--uw-rail-bg")).toBe(RAIL_VAR_FALLBACK["--uw-rail-bg"]);
  });

  // Rail luôn là panel tối ở CẢ hai theme, nên brand của nó là brand của `.dark`.
  it("--uw-brand khớp giá trị ở .dark", () => {
    expect(readVar(/\.dark\s*\{[\s\S]*?\n\}/, "--uw-brand")).toBe(RAIL_VAR_FALLBACK["--uw-brand"]);
  });
});
