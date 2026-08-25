import { expect, test, type Page } from "@playwright/test";

test.use({ viewport: { width: 1440, height: 900 } });

async function reachAboutYou(page: Page) {
  const stamp = Date.now();
  await page.goto("/register");
  await page.getByLabel("Tên hiển thị").fill("Focus");
  await page.getByLabel("Email").fill(`focus-${stamp}@example.com`);
  await page.getByLabel("Mật khẩu").fill("password123");
  await page.getByRole("button", { name: "Đăng ký" }).click();
  await page.waitForURL(/\/onboarding$/);
  await page.getByRole("button", { name: /Bắt đầu/ }).click();
  await page.getByText("Cho chúng tôi biết đôi chút về bạn.").waitFor();
}

/**
 * Điều hướng bằng bàn phím hỏng âm thầm: giao diện vẫn đúng bằng mắt trong khi
 * người dùng bàn phím mất dấu mình đang ở đâu. Hai lỗi từng có thật mà test này
 * chặn lại: viền focus toàn cục nằm ngoài cascade layer nên đè mọi
 * `focus:outline-none` và sinh ring đôi; và control trong suốt phủ chip khiến
 * chỉ báo focus rơi lên một element opacity-0.
 */
test("mọi điểm dừng Tab trong onboarding đều có chỉ báo focus nhìn thấy được", async ({ page }) => {
  await reachAboutYou(page);

  const bare: string[] = [];
  for (let i = 0; i < 20; i++) {
    await page.keyboard.press("Tab");
    const info = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el || el === document.body) return null;
      // Lớp phủ dev của Next.js không thuộc app.
      if (el.tagName.toLowerCase() === "nextjs-portal") return null;

      const visibleShadow = (n: Element | null) => {
        if (!n) return false;
        const s = getComputedStyle(n).boxShadow;
        return s !== "none" && /rgb\((?!0, 0, 0, 0)/.test(s.replace(/rgba\(0, 0, 0, 0\)[^,]*/g, ""));
      };
      const cs = getComputedStyle(el);
      // Viền chỉ tính khi chính element nhìn thấy được — element opacity-0 thì
      // viền của nó cũng trong suốt.
      const ownOutline = cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) > 0 && cs.opacity !== "0";
      // Ring có thể nằm trên chính element hoặc trên một tổ tiên gần (mẫu
      // `focus-within` của chip). Đi lên vài bậc thay vì đoán đúng một bậc.
      let ring = false;
      let node: HTMLElement | null = el;
      for (let up = 0; up < 3 && node && !ring; up++) {
        ring = visibleShadow(node);
        node = node.parentElement;
      }

      return {
        ok: ownOutline || ring,
        what: `${el.tagName.toLowerCase()} "${(el.getAttribute("aria-label") ?? el.textContent ?? "").trim().slice(0, 24)}"`,
      };
    });
    if (info && !info.ok) bare.push(info.what);
  }

  expect(bare, `điểm dừng Tab không có chỉ báo focus: ${bare.join(", ")}`).toEqual([]);
});

test("chỉ có MỘT chỉ báo focus, không lồng hai vòng", async ({ page }) => {
  await reachAboutYou(page);
  await page.getByRole("radio", { name: "Khác" }).first().click();

  const free = page.getByRole("textbox").first();
  await free.focus();
  const doubled = await free.evaluate((el) => {
    const cs = getComputedStyle(el);
    return cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) > 0;
  });
  // Chip vẽ ring bằng `focus-within`; ô nhập bên trong không được vẽ thêm viền.
  expect(doubled, "ô nhập tự do vẽ viền riêng chồng lên ring của chip").toBe(false);
});

/**
 * Chỉ báo focus CÓ MẶT chưa đủ — nó còn phải phân biệt được với thứ nó đang chỉ.
 * Lỗi thật đã xảy ra: ring `brand` vẽ sát nút nền `brand` (1.00:1). Test "có
 * box-shadow" ở trên vẫn xanh, trong khi bằng mắt nút chỉ to thêm 2px.
 *
 * Phải đo TẠI ĐIỂM DỪNG TAB THẬT: `--tw-ring-color` chỉ tồn tại trong khối
 * `:focus-visible`, đọc nó trên một nút không có tiêu điểm luôn ra chuỗi rỗng —
 * và test sẽ xanh mà chẳng kiểm tra gì.
 */
test("vòng focus tách được khỏi nền ngay sát nó (>= 3:1)", async ({ page }) => {
  await reachAboutYou(page);

  const offenders: string[] = [];
  for (let i = 0; i < 20; i++) {
    await page.keyboard.press("Tab");
    const bad = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el || el === document.body) return null;
      if (el.tagName.toLowerCase() === "nextjs-portal") return null;

      // Chuẩn hoá MỌI cú pháp màu về rgb bằng chính trình duyệt. Token của app
      // là hex (`--tw-ring-color: #2f5aff`), nên bóc số bằng regex kiểu rgb() sẽ
      // ra `[2, 5]` — vẫn tính được một tỉ số trông hợp lệ, và test xanh giả.
      const probe = document.createElement("span");
      probe.style.display = "none";
      document.body.appendChild(probe);
      const parse = (c: string): number[] => {
        probe.style.color = "";
        probe.style.color = c;
        const resolved = getComputedStyle(probe).color;
        const n = (resolved.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
        return n.length === 3 ? n : [];
      };
      const lum = (rgb: number[]) =>
        rgb
          .map((v) => {
            const s = v / 255;
            return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
          })
          .reduce((acc, c, idx) => acc + c * [0.2126, 0.7152, 0.0722][idx]!, 0);
      const ratio = (a: number[], b: number[]) => {
        const [x, y] = [lum(a), lum(b)];
        return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
      };
      const opaque = (c: string) => c !== "" && !/rgba\(0, 0, 0, 0\)|transparent/.test(c);
      const backdrop = (n: Element | null): number[] => {
        for (let x = n; x; x = x.parentElement) {
          const bg = getComputedStyle(x).backgroundColor;
          if (opaque(bg)) return parse(bg);
        }
        return [255, 255, 255];
      };

      // Ring có thể nằm trên chính element hoặc trên tổ tiên gần (mẫu
      // `focus-within` của chip) — đi lên vài bậc, giống test ở trên.
      let host: HTMLElement | null = el;
      let ring = "";
      for (let up = 0; up < 3 && host && !ring; up++) {
        const c = getComputedStyle(host).getPropertyValue("--tw-ring-color").trim();
        if (opaque(c)) { ring = c; break; }
        host = host.parentElement;
      }
      const label = `${el.tagName.toLowerCase()} "${(el.getAttribute("aria-label") ?? el.textContent ?? "").trim().slice(0, 22)}"`;

      if (ring && host) {
        const cs = getComputedStyle(host);
        const offset = parseFloat(cs.getPropertyValue("--tw-ring-offset-width")) || 0;
        // Có khoảng hở → ring nằm cạnh MÀU HỞ. Không hở → ring dán thẳng vào
        // nền của chính element, và đó là phía dễ trượt nhất.
        const gapColor = parse(cs.getPropertyValue("--tw-ring-offset-color").trim());
        const neighbour = offset > 0 && gapColor.length === 3 ? gapColor : backdrop(host);
        const ringRgb = parse(ring);
        if (ringRgb.length !== 3) return `${label} không đọc được màu ring "${ring}"`;
        const r = ratio(ringRgb, neighbour);
        probe.remove();
        return r < 3 ? `${label} ring ${r.toFixed(2)}:1 (offset ${offset}px)` : null;
      }

      const cs = getComputedStyle(el);
      if (cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) > 0) {
        // `outline-offset` dương → viền nằm trên nền của tổ tiên, không phải nền
        // của chính element.
        const gap = parseFloat(cs.outlineOffset) || 0;
        const neighbour = gap > 0 ? backdrop(el.parentElement) : backdrop(el);
        const r = ratio(parse(cs.outlineColor), neighbour);
        probe.remove();
        return r < 3 ? `${label} outline ${r.toFixed(2)}:1` : null;
      }
      probe.remove();
      return null;
    });
    if (bad) offenders.push(bad);
  }

  expect(offenders, `chỉ báo focus không tách khỏi nền sát nó: ${offenders.join(" | ")}`).toEqual([]);
});
