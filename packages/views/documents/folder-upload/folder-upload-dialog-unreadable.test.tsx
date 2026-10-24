import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FolderUploadPlan } from "@uniwork/core/documents/folder-upload";
import { initI18n, setLocale } from "@uniwork/core/i18n";
import type { DesktopPlatformGuess, OfficeLaunchOutcome } from "@uniwork/core/office";
import type { OfficeHomeLaunchProps } from "../../office/office-home-launch";
import { FolderUploadDialog, type FolderUploadDialogProps } from "./folder-upload-dialog";

initI18n();

const MIB = 1024 * 1024;
// Real names of the folder that failed in Edge (text only: the tests never open it).
const ROOT = "2022.15022.2022 - HĐKT-NEO-VIETANTS pt phần mềm hệ thống Sales Portal trên ứng dụng Mobile ( 2 tỷ 073)";
const DEEP = "HĐ số 17.2022.HĐKT.PPMU-NEO - Sales portal/Gia han bao lanh/CV để nghị gia hạn CĐT";
const FILE = "Đề nghị gia hạn bảo lãnh - gia han bao lanh 19.6.2023_0001.pdf";
const ONE = `${ROOT}/${DEEP}/${FILE}`;

function plan(over: Partial<FolderUploadPlan> = {}): FolderUploadPlan {
  return {
    rootName: ROOT,
    rootTitle: ROOT,
    folders: [ROOT],
    files: [],
    skipped: [],
    totals: { files: 20, bytes: 25.3 * MIB },
    refusal: null,
    ...over,
  };
}

const windows: DesktopPlatformGuess = { platform: "win32-x64", confidence: "certain" };

function officeHome(over: Partial<OfficeHomeLaunchProps> = {}): OfficeHomeLaunchProps {
  return {
    channel: "stable",
    launch: vi.fn(async (): Promise<OfficeLaunchOutcome> => "launched"),
    loadInstallers: vi.fn(async () => ({ installers: [] })),
    loadPlatformHint: vi.fn(async () => windows),
    downloadInstaller: vi.fn(async () => "UniWork-Office.exe"),
    ...over,
  };
}

function renderDialog(over: Partial<FolderUploadDialogProps> = {}) {
  const onSubmit = vi.fn();
  const onOpenChange = vi.fn();
  const onHandoff = vi.fn();
  render(
    <FolderUploadDialog
      open
      onOpenChange={onOpenChange}
      plan={plan()}
      destinationName="Thư mục của tôi"
      onSubmit={onSubmit}
      onHandoff={onHandoff}
      unreadable={[ONE]}
      officeHome={officeHome()}
      {...over}
    />,
  );
  return { onSubmit, onOpenChange, onHandoff };
}

const openApp = () => screen.findByRole("button", { name: "Mở UniWork Office" });
const rest = (count: number) => screen.getByRole("button", { name: `Tải ${count} tệp còn lại` });

// Seven files in three folders (48 files in the pick).
const SEVEN = [
  `${ROOT}/A/one.pdf`,
  `${ROOT}/A/two.pdf`,
  `${ROOT}/A/three.pdf`,
  `${ROOT}/B/four.pdf`,
  `${ROOT}/B/five.pdf`,
  `${ROOT}/C/six.pdf`,
  `${ROOT}/C/seven.pdf`,
];

beforeEach(async () => {
  await setLocale("vi");
});
afterEach(() => vi.restoreAllMocks());

describe("FolderUploadDialog with no affected file", () => {
  it("is today's dialog: no warning, focus on Tải lên", async () => {
    renderDialog({ unreadable: [] });
    expect(screen.getByRole("heading", { name: "Tải lên thư mục" })).toBeInTheDocument();
    expect(screen.queryByText(/Tệp bị ảnh hưởng/)).toBeNull();
    expect(screen.queryByRole("button", { name: "Mở UniWork Office" })).toBeNull();
    await waitFor(() => expect(screen.getByRole("button", { name: "Tải lên" })).toHaveFocus());
  });
});

describe("FolderUploadDialog while checking", () => {
  it("says it is checking, blocks Tải lên in JS, and Hủy still works", async () => {
    const { onSubmit, onOpenChange } = renderDialog({ unreadable: [], checking: true });
    expect(screen.getByRole("status")).toHaveTextContent("Đang kiểm tra thư mục…");
    const submit = screen.getByRole("button", { name: "Tải lên" });
    expect(submit).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(submit);
    expect(onSubmit).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Hủy" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("names the files when the run is a files-mode run", () => {
    renderDialog({ plan: plan({ rootName: null, rootTitle: null, folders: [] }), unreadable: [], checking: true });
    expect(screen.getByRole("status")).toHaveTextContent("Đang kiểm tra các tệp…");
  });
});

describe("FolderUploadDialog with one affected file (the real case)", () => {
  it("turns into the warning: title, why, the file, the suggestion, three actions", async () => {
    renderDialog();
    expect(screen.getByRole("heading", { name: "Có 1 tệp trình duyệt không đọc được" })).toBeInTheDocument();
    expect(screen.getByText("Đường dẫn tệp này trên máy quá dài, trình duyệt không mở được.")).toBeInTheDocument();
    expect(screen.getByText("Tệp bị ảnh hưởng · 1")).toBeInTheDocument();
    // The root is in the dl already: the row carries the path under it.
    const row = screen.getByRole("listitem");
    expect(row).toHaveTextContent(FILE);
    expect(row).toHaveTextContent(DEEP);
    expect(row).not.toHaveTextContent(ROOT);
    expect(row).toHaveAttribute("title", `${DEEP}/${FILE}`);
    expect(row).toHaveAttribute("tabindex", "0");
    expect(screen.getByRole("note")).toHaveTextContent("UniWork Office tải được thư mục này.");
    expect(screen.getByRole("note")).toHaveTextContent("Mở ứng dụng rồi chọn lại thư mục này.");
    expect(screen.getByRole("note")).toHaveTextContent("Tải lên › Tải lên thư mục");
    // The summary stays: 20 files in all, the pick is unchanged.
    expect(screen.getByTestId("folder-upload-summary")).toHaveTextContent("20 tệp");
    expect(screen.getByRole("switch")).toBeInTheDocument();
    const names = screen.getAllByRole("button").map((button) => button.textContent);
    expect(names).toEqual(expect.arrayContaining(["Hủy", "Tải 19 tệp còn lại", "Mở UniWork Office"]));
    // Tab order: Hủy, the rest, then the primary.
    const footer = screen.getByRole("button", { name: "Hủy" }).parentElement as HTMLElement;
    expect(within(footer).getAllByRole("button").map((b) => b.textContent)).toEqual(["Hủy", "Tải 19 tệp còn lại", "Mở UniWork Office"]);
  });

  it("starts on Mở UniWork Office", async () => {
    renderDialog();
    await waitFor(async () => expect(await openApp()).toHaveFocus());
  });

  it("uploads the rest through the dialog's own submit", async () => {
    const { onSubmit } = renderDialog();
    await openApp();
    fireEvent.click(rest(19));
    expect(onSubmit).toHaveBeenCalledWith({ shareWithWorkspace: false });
  });

  it("keeps the share switch for the rest", async () => {
    const { onSubmit } = renderDialog();
    await openApp();
    fireEvent.click(screen.getByRole("switch"));
    fireEvent.click(rest(19));
    expect(onSubmit).toHaveBeenCalledWith({ shareWithWorkspace: true });
  });

  it("has the footer band reach the dialog's edges", async () => {
    renderDialog();
    await openApp();
    const footer = screen.getByRole("button", { name: "Hủy" }).parentElement as HTMLElement;
    expect(footer.className).toContain("-mx-4");
    expect(footer.className).toContain("-mb-4");
  });

  it("opens the app on press and hands the folder over without writing anything", async () => {
    const home = officeHome();
    const { onSubmit, onHandoff } = renderDialog({ officeHome: home });
    fireEvent.click(await openApp());
    await waitFor(() => expect(home.launch).toHaveBeenCalledWith("uniwork-office://home", expect.anything()));
    await waitFor(() => expect(onHandoff).toHaveBeenCalledOnce());
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("shows Đang mở… while launching: the primary and the rest are aria-disabled, Hủy stays live", async () => {
    let finish: (outcome: OfficeLaunchOutcome) => void = () => undefined;
    const home = officeHome({ launch: vi.fn(() => new Promise<OfficeLaunchOutcome>((resolve) => { finish = resolve; })) });
    const { onSubmit, onHandoff, onOpenChange } = renderDialog({ officeHome: home });
    fireEvent.click(await openApp());
    const busy = await screen.findByRole("button", { name: "Đang mở…" });
    expect(busy).toHaveAttribute("aria-busy", "true");
    expect(busy).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(busy);
    expect(home.launch).toHaveBeenCalledOnce();
    expect(rest(19)).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(rest(19));
    expect(onSubmit).not.toHaveBeenCalled();
    const cancel = screen.getByRole("button", { name: "Hủy" });
    expect(cancel).not.toHaveAttribute("aria-disabled");
    fireEvent.click(cancel);
    expect(onOpenChange).toHaveBeenCalledWith(false);
    finish("launched");
    await waitFor(() => expect(onHandoff).toHaveBeenCalledOnce());
  });

  it.each<OfficeLaunchOutcome>(["launched", "not-installed", "error"])(
    "hands over on %s: no install prompt opens over the warning, and without installers there is nothing to offer",
    async (outcome) => {
      const home = officeHome({ launch: vi.fn(async (): Promise<OfficeLaunchOutcome> => outcome) });
      const { onHandoff, onSubmit } = renderDialog({ officeHome: home });
      fireEvent.click(await openApp());
      await waitFor(() => expect(onHandoff).toHaveBeenCalledOnce());
      expect(onHandoff).toHaveBeenCalledWith(null);
      expect(screen.queryByRole("dialog", { name: "Tải UniWork Office cho máy tính" })).toBeNull();
      expect(onSubmit).not.toHaveBeenCalled();
    },
  );

  it("offers the install prompt to the host when installers exist for this channel, and loads them once", async () => {
    const installer = { platform: "win32-x64" as const, url: "https://x/UniWork-Office.exe", kind: "exe", channel: "stable" as const };
    const home = officeHome({
      launch: vi.fn(async (): Promise<OfficeLaunchOutcome> => "not-installed"),
      loadInstallers: vi.fn(async () => ({ installers: [installer] })),
    });
    const { onHandoff } = renderDialog({ officeHome: home });
    fireEvent.click(await openApp());
    await waitFor(() => expect(onHandoff).toHaveBeenCalledOnce());
    expect(onHandoff).toHaveBeenCalledWith(expect.any(Function));
    expect(home.loadInstallers).toHaveBeenCalledOnce();
    expect(screen.queryByRole("dialog", { name: "Tải UniWork Office cho máy tính" })).toBeNull();
  });

  it("offers nothing when the installers cannot be loaded", async () => {
    const home = officeHome({
      launch: vi.fn(async (): Promise<OfficeLaunchOutcome> => "not-installed"),
      loadInstallers: vi.fn(async () => {
        throw new Error("down");
      }),
    });
    const { onHandoff } = renderDialog({ officeHome: home });
    fireEvent.click(await openApp());
    await waitFor(() => expect(onHandoff).toHaveBeenCalledWith(null));
  });
});

describe("FolderUploadDialog's collision note", () => {
  const renamed = plan({ rootTitle: `${ROOT} (2)` });

  it("wraps its whole text: no clamp, no truncation, shrinkable", () => {
    renderDialog({ plan: renamed });
    const note = screen.getByTestId("folder-upload-renamed");
    expect(note.textContent).toContain(ROOT);
    expect(note.textContent).toContain(`${ROOT} (2)`);
    for (const cls of ["truncate", "line-clamp", "overflow-hidden", "text-ellipsis"]) expect(note.className).not.toContain(cls);
    expect(note.className).toContain("min-w-0");
    expect(note.className).toContain("break-words");
  });

  it("keeps the form inside the dialog's single column so a long name cannot widen it", () => {
    renderDialog({ plan: renamed });
    const dialog = screen.getByTestId("folder-upload-dialog");
    expect((dialog.querySelector("form") as HTMLElement).className).toContain("min-w-0");
    expect(dialog.className).toContain("grid-cols-[minmax(0,1fr)]");
  });
});

describe("FolderUploadDialog with several affected files", () => {
  it("shows the first three rows and folds the rest behind + N tệp khác", async () => {
    renderDialog({ unreadable: SEVEN, plan: plan({ totals: { files: 48, bytes: 10 * MIB } }) });
    expect(screen.getByRole("heading", { name: "Có 7 tệp trình duyệt không đọc được" })).toBeInTheDocument();
    expect(screen.getByText("Đường dẫn các tệp này trên máy quá dài, trình duyệt không mở được.")).toBeInTheDocument();
    expect(screen.getByText("Tệp bị ảnh hưởng · 7")).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
    const more = screen.getByRole("button", { name: "+ 4 tệp khác" });
    expect(more).toHaveAttribute("aria-expanded", "false");
    expect(rest(41)).toBeInTheDocument();

    fireEvent.click(more);
    expect(screen.getAllByRole("listitem")).toHaveLength(7);
    const less = screen.getByRole("button", { name: "Thu gọn" });
    expect(less).toHaveAttribute("aria-expanded", "true");
    expect(less).toHaveAttribute("aria-controls", screen.getByRole("list").id);

    fireEvent.click(less);
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
  });

  it("starts collapsed for each staged folder", async () => {
    const first = plan();
    const props = { open: true, onOpenChange: vi.fn(), destinationName: "X", onSubmit: vi.fn(), unreadable: SEVEN, officeHome: officeHome() };
    const { rerender } = render(<FolderUploadDialog {...props} plan={first} />);
    fireEvent.click(screen.getByRole("button", { name: "+ 4 tệp khác" }));
    expect(screen.getAllByRole("listitem")).toHaveLength(7);
    // The same plan: still expanded; the next staged folder starts folded.
    rerender(<FolderUploadDialog {...props} plan={first} />);
    expect(screen.getAllByRole("listitem")).toHaveLength(7);
    rerender(<FolderUploadDialog {...props} plan={plan({ totals: { files: 30, bytes: MIB } })} />);
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
  });
});

describe("FolderUploadDialog where nothing would be left", () => {
  it("has no secondary action when every planned file is affected", async () => {
    renderDialog({ plan: plan({ totals: { files: 1, bytes: 0 } }) });
    await openApp();
    expect(screen.queryByRole("button", { name: /tệp còn lại/ })).toBeNull();
    const footer = screen.getByRole("button", { name: "Hủy" }).parentElement as HTMLElement;
    expect(within(footer).getAllByRole("button").map((b) => b.textContent)).toEqual(["Hủy", "Mở UniWork Office"]);
  });
});

describe("FolderUploadDialog with no app to open", () => {
  it("without host wiring: suggests a shorter path and makes the rest primary", async () => {
    const { onSubmit } = renderDialog({ officeHome: undefined });
    expect(screen.queryByRole("button", { name: "Mở UniWork Office" })).toBeNull();
    expect(screen.getByRole("note")).toHaveTextContent("Chép thư mục vào chỗ có đường dẫn ngắn hơn rồi tải lại thư mục.");
    expect(screen.getByRole("note")).not.toHaveTextContent("UniWork Office");
    await waitFor(() => expect(rest(19)).toHaveFocus());
    fireEvent.click(rest(19));
    expect(onSubmit).toHaveBeenCalledOnce();
  });

  it("on a device the app has no installer for (phones, tablets)", async () => {
    const home = officeHome({ loadPlatformHint: vi.fn(async (): Promise<DesktopPlatformGuess> => ({ platform: null, confidence: "unsupported" })) });
    renderDialog({ officeHome: home });
    await waitFor(() => expect(screen.getByRole("note")).toHaveTextContent("Chép thư mục vào chỗ có đường dẫn ngắn hơn"));
    expect(screen.queryByRole("button", { name: "Mở UniWork Office" })).toBeNull();
    expect(rest(19)).toBeInTheDocument();
  });
});

describe("FolderUploadDialog in files mode", () => {
  const filesPlan = plan({ rootName: null, rootTitle: null, folders: [], totals: { files: 12, bytes: MIB } });

  it("uses the files nouns and the files menu path", async () => {
    renderDialog({ plan: filesPlan, unreadable: ["Báo cáo.pdf"] });
    await openApp();
    expect(screen.getByRole("note")).toHaveTextContent("UniWork Office tải được các tệp này.");
    expect(screen.getByRole("note")).toHaveTextContent("chọn lại các tệp này");
    expect(screen.getByRole("note")).toHaveTextContent("Tải lên › Tải lên tệp");
    expect(rest(11)).toBeInTheDocument();
    // No root to strip: the row is the file alone.
    expect(screen.getByRole("listitem")).toHaveTextContent("Báo cáo.pdf");
  });
});

describe("FolderUploadDialog in English", () => {
  it("reads singular and plural, and the arrow path never wraps", async () => {
    await setLocale("en");
    renderDialog({ unreadable: SEVEN });
    expect(screen.getByRole("heading", { name: "7 files the browser cannot read" })).toBeInTheDocument();
    expect(screen.getByText("Affected files · 7")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "+ 4 more" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Upload the other 13 files" })).toBeInTheDocument();
    expect(screen.getByRole("note").textContent).toContain("Upload › Upload folder");
  });

  it("reads the singular", async () => {
    await setLocale("en");
    renderDialog();
    expect(screen.getByRole("heading", { name: "1 file the browser cannot read" })).toBeInTheDocument();
    expect(screen.getByText("The path of this file on this computer is too long for the browser to open.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Upload the other 19 files" })).toBeInTheDocument();
  });
});
