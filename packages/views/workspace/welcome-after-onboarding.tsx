"use client";
import { ArrowRight, ListChecks } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { dismissWelcome, useSeedWelcomeTask, useWelcomeSignal } from "@uniwork/core/onboarding";
import type { Workspace } from "@uniwork/core/types";
import { Logo } from "@uniwork/ui/brand";
import { IconTile } from "@uniwork/ui/components/common/icon-tile";
import { Button } from "@uniwork/ui/components/ui/button";
import { Dialog,
  DialogContent,
  DialogTitle,
} from "@uniwork/ui/components/ui/dialog";
import { moduleTone } from "../layout/module-tones";

/** Một lần sau onboarding: seed task hướng dẫn (server idempotent) rồi dialog chào mừng. */
export function WelcomeAfterOnboarding({ workspace, onOpenTask }: { workspace: Workspace; onOpenTask: (taskId: string) => void }) {
  const { signal, dismissed } = useWelcomeSignal();
  if (!signal || dismissed || signal.workspaceId !== workspace.id) return null;
  return <Seeder workspaceId={workspace.id} onOpenTask={onOpenTask} />;
}

/**
 * Một khung duy nhất cho cả ba trạng thái (đang seed / xong / lỗi). Trước đây
 * trạng thái chờ là overlay riêng phủ toàn màn hình, nên người dùng thấy một cú
 * nhảy từ lớp phủ lớn sang hộp nhỏ. Giữ nguyên hộp, chỉ đổi ruột.
 *
 * `showCloseButton={false}`: nút X cũ chỉ đóng, trong khi nút chính vừa đóng vừa
 * mở task — hai lối thoát cho hai kết cục khác nhau mà không có gì báo trước.
 * Giờ mọi lối thoát đều có nhãn, và Esc/bấm ra ngoài trùng nghĩa với "Để sau".
 */
function WelcomeShell({ children }: { children: ReactNode }) {
  return (
    <Dialog open onOpenChange={(o) => { if (!o) dismissWelcome(); }}>
      <DialogContent className="gap-5 p-6 sm:max-w-xl" overlayClassName="bg-black/45" showCloseButton={false}>
        {children}
      </DialogContent>
    </Dialog>
  );
}

/**
 * Hình mở đầu dialog là chính dấu UniWork, không phải một icon mượn. Bản cũ
 * dùng emoji 🎉 — thứ đổi hình theo hệ điều hành, không nhận token và không nói
 * gì về sản phẩm. Đây là lần đầu người dùng thấy workspace của mình, nên chỗ
 * này phải là thương hiệu.
 *
 * `animate-pulse` lúc chờ là cùng một ngôn ngữ với `workspace-loader.tsx`:
 * trong sản phẩm, dấu UniWork đập nhẹ nghĩa là đang tải.
 */
function WelcomeMark({ state }: { state: "ready" | "loading" | "error" }) {
  return (
    <Logo
      variant="mark"
      size={48}
      decorative
      className={state === "ready" ? "animate-welcome-glyph-pop" : state === "loading" ? "animate-pulse" : undefined}
    />
  );
}

/**
 * Thẻ hướng dẫn — một nút thật; bản cũ trông y hệt một thẻ task nhưng bấm không
 * có gì xảy ra. Không truyền `onOpen` là lúc còn đang seed: cùng khung, cùng chữ,
 * chỉ chưa bấm được, nên không có cú nhảy chiều cao ở bất kỳ bề rộng nào.
 *
 * `border-input` là token dành cho đường bao của control, và là token duy nhất
 * đạt 3:1 so với nền hộp ở cả hai chế độ (3.56 sáng, 4.18 tối) — WCAG 1.4.11.
 * Màu nhận diện nằm ở ô icon và lấy tint của module Công việc: theo PRODUCT.md
 * chỉ tint mới nhận diện module, còn `brand` là màu tín hiệu, không dùng để trang trí.
 *
 * `aria-label` viết tay vì hai span khối không tự chèn khoảng trắng khi trình
 * duyệt ghép tên khả truy cập — không có nó, trình đọc màn hình đọc liền thành
 * "UniWorkTạo việc". Nhãn mở đầu bằng đúng chữ nhìn thấy được nên vẫn thoả
 * WCAG 2.5.3.
 */
function GuideCard({ onOpen }: { onOpen?: () => void }) {
  const { t } = useTranslation();
  const title = t("onboarding.welcome_after_onboarding.card_title");
  const subtitle = t("onboarding.welcome_after_onboarding.card_subtitle");
  const duration = t("onboarding.welcome_after_onboarding.card_duration");
  const idle = !onOpen;
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-disabled={idle || undefined}
      aria-label={`${title}. ${subtitle} ${duration}`}
      className={
        "group flex w-full items-center gap-3 rounded-xl border border-input bg-surface-hover px-4 py-3 text-left transition-colors" +
        (idle ? " cursor-not-allowed opacity-60" : " cursor-pointer hover:bg-tint-green")
      }
    >
      <IconTile icon={ListChecks} tone={moduleTone("tasks")} variant="solid" size="md" />
      {/* Thời lượng nằm cùng dòng mô tả, không phải chip riêng: ở 375px một chip
          cạnh tiêu đề bị đẩy xuống dòng lẻ, làm thẻ cao lên và lệch nhịp. */}
      <span className="min-w-0 flex-1">
        <span className="block text-body font-medium text-foreground">{title}</span>
        <span className="mt-0.5 block text-caption text-muted-foreground">
          {subtitle}
          <span aria-hidden> · </span>
          {duration}
        </span>
      </span>
      <ArrowRight className="size-4 shrink-0 text-muted-foreground transition-[color,transform] group-hover:translate-x-0.5 group-hover:text-foreground" />
    </button>
  );
}

function Seeder({ workspaceId, onOpenTask }: { workspaceId: string; onOpenTask: (id: string) => void }) {
  const { t } = useTranslation();
  const seed = useSeedWelcomeTask();
  const [taskId, setTaskId] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const fired = useRef(false); // StrictMode double-mount: server idempotent, nhưng tránh 2 request

  useEffect(() => {
    if (fired.current || taskId || failed) return;
    fired.current = true;
    seed.mutate(workspaceId, {
      onSuccess: (task) => {
        if (task) setTaskId(task.id);
      },
      onError: () => {
        setFailed(true);
        fired.current = false;
      },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId, taskId, failed]);

  if (failed) {
    return (
      <WelcomeShell>
        <DialogTitle className="sr-only">{t("onboarding.welcome_after_onboarding.error_title")}</DialogTitle>
        <div className="flex flex-col items-center gap-4 pt-2">
          <WelcomeMark state="error" />
          <h2 className="text-center text-display-sm font-semibold text-foreground">
            {t("onboarding.welcome_after_onboarding.error_title")}
          </h2>
          <p className="max-w-md text-center text-body text-muted-foreground">
            {t("onboarding.welcome_after_onboarding.error_body")}
          </p>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="lg" onClick={dismissWelcome}>
            {t("onboarding.welcome_after_onboarding.dismiss")}
          </Button>
          <Button size="lg" onClick={() => setFailed(false)}>
            {t("onboarding.welcome_after_onboarding.retry")}
          </Button>
        </div>
      </WelcomeShell>
    );
  }

  if (!taskId) {
    return (
      <WelcomeShell>
        <DialogTitle className="sr-only">{t("onboarding.welcome_after_onboarding.loading")}</DialogTitle>
        <div className="flex flex-col items-center gap-4 pt-2">
          <WelcomeMark state="loading" />
          <p className="text-center text-body text-muted-foreground" role="status" aria-live="polite">
            {t("onboarding.welcome_after_onboarding.loading")}
          </p>
        </div>
        {/* Chính thẻ thật, chỉ chưa bấm được. Nội dung thẻ là chữ tĩnh; thứ duy
            nhất còn thiếu lúc này là id của task. Một skeleton ở đây vừa thừa vừa
            không bao giờ cao đúng bằng thẻ thật khi chữ xuống dòng ở màn hẹp. */}
        <GuideCard />
        {/* Nút thật chứ không phải skeleton: người dùng không có lý do gì phải bị
            giam lại chờ seed xong mới được rời đi. */}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="lg" onClick={dismissWelcome}>
            {t("onboarding.welcome_after_onboarding.dismiss")}
          </Button>
          <Button size="lg" aria-disabled>
            {t("onboarding.welcome_after_onboarding.open_task")}
          </Button>
        </div>
      </WelcomeShell>
    );
  }

  const openTask = () => {
    dismissWelcome();
    onOpenTask(taskId);
  };

  return (
    <WelcomeShell>
      {/* The heading below is the visible one; the dialog still needs an
          accessible name, so this repeats it for screen readers only. */}
      <DialogTitle className="sr-only">{t("onboarding.welcome_after_onboarding.title")}</DialogTitle>
      <div className="flex flex-col items-center gap-4 pt-2">
        <WelcomeMark state="ready" />
        <h2 className="text-center text-display-sm font-semibold text-foreground">{t("onboarding.welcome_after_onboarding.title")}</h2>
        <p className="max-w-md text-center text-body text-muted-foreground">{t("onboarding.welcome_after_onboarding.subtitle")}</p>
      </div>
      <GuideCard onOpen={openTask} />
      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="lg" onClick={dismissWelcome}>
          {t("onboarding.welcome_after_onboarding.dismiss")}
        </Button>
        <Button size="lg" onClick={openTask}>
          {t("onboarding.welcome_after_onboarding.open_task")}
        </Button>
      </div>
    </WelcomeShell>
  );
}
