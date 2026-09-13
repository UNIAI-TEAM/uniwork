# Task human-parity lát C — hợp nhất picker và sửa tại chỗ

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Trạng thái:** in-progress — lát C của spec ô Task human-parity

**Goal:** Một bộ picker trường công việc duy nhất, dùng chung cho ô bảng, sidebar chi tiết và thanh hành động hàng loạt, thay cho ba bản cài đặt song song hiện nay; cộng picker ngày và menu hành động trên hàng.

**Architecture:** Đây là hợp nhất, không phải dựng mới. UniWork đã có đủ primitive và đã có ba bản cài đặt riêng cho cùng nhóm trường. Mỗi task rút một họ trường ra `packages/views/tasks/pickers/` rồi chuyển cả ba nơi tiêu thụ sang dùng nó, nên mỗi task tự nó là một lát cắt dọc kiểm chứng được, và hồi quy lộ ra ngay tại task gây ra nó.

**Tech Stack:** TypeScript strict, React 19, TanStack Query, primitive shadcn/Base UI trong `packages/ui`, Vitest, Testing Library.

**Spec:** `docs/superpowers/specs/2026-09-12-tasks-human-parity-design.md` (mục 3.1 lát C)

## Phát hiện đổi hình dạng lát này

Spec phác lát C là "dựng bộ picker mới". Khảo sát trước khi viết plan cho thấy giả định đó sai. UniWork có **ba bản cài đặt song song** cho cùng nhóm trường:

| Nơi | File | Có sẵn |
| --- | --- | --- |
| Bảng | `tasks/modes/table-cell-editors.tsx` (416 dòng) | status, priority, assignee, due date, labels |
| Sidebar chi tiết | `tasks/detail/components/properties-sidebar.tsx` (406 dòng) | status, priority, assignee (DropdownMenu + Select) |
| Hàng loạt | `tasks/views/batch-pickers.tsx` (159 dòng) | status, priority, assignee |

`CLAUDE.md` cấm dựng thêm abstraction song song, và cũng cấm refactor rộng khi việc không đòi. Lát này đi giữa: hợp nhất đúng những họ trường mà cả ba nơi đều đã có, vì thêm trường mới kiểu gì cũng phải sửa cả ba.

**Ngoài phạm vi, đã quyết:** picker thuộc tính tùy biến. Nó không phải một picker mà là nối dây cả một danh mục; `board-view.tsx` và `table-column-picker.tsx` đều đang ghi chú chờ "property catalog capability". Việc đó cần spec riêng.

## Global Constraints

- Không đụng `server/`. Lát này không có thay đổi backend.
- Mỗi file `.ts`/`.tsx` tối đa 500 dòng theo `max-lines`, không đếm dòng trống và comment.
- Mọi JSX text node trong `packages/views/` đi qua `t()`.
- Khóa i18n mới phải có ở **cả** `vi.json` và `en.json`. Khóa có đếm phải dùng dạng `_one` / `_other` — repo có 18 khóa như vậy, và khóa đơn với `{{count}}` đọc ổn tiếng Việt nhưng ra "1 replies" ở tiếng Anh.
- Dùng primitive sẵn có trong `packages/ui/components/ui/`: `combobox`, `command`, `popover`, `calendar`, `select`, `dropdown-menu`. Thêm primitive mới chỉ bằng `pnpm ui:add`.
- Bốn hợp đồng khả năng tiếp cận trong primitive không được phá: `aria-disabled` giữ nút trong thứ tự tab và chặn hành động bằng JS; vùng chạm ≥ 44px trên con trỏ thô; viền `:focus-visible` toàn cục là chỉ báo focus, không `outline-none`; `StepperTitle` là `span`.
- Không export, file hay dependency thừa — `pnpm knip` chạy trong cổng.
- Sàn coverage chỉ đi lên. Sàn `views` hiện: statements 60, branches 53, functions 53, lines 62.
- Tiền tố commit: `feat(scope)`, `fix(scope)`, `refactor(scope)`, `test(scope)`, `docs`, `chore(scope)`. Hook tự gắn `Refs:`.
- **Mọi lệnh vitest phải có `NODE_OPTIONS="--no-experimental-webstorage"`.** Máy chạy Node 25, dự án nhắm Node 22.
- Baseline: views 1246, core 719.
- Lỗi nền đã biết, KHÔNG phải của bạn: `governance.test.mjs` kiểm lịch sử commit; Go `TestChatFollowUpHTTP`, `TestChatThreadFollowMarkReadAndList`, `TestAIEndpoints`, `TestAskCitesOnlyPermittedSources`, `TestSearchScoringOverdueAndMembers`; e2e smoke "register → workspace → task → meeting"; nhiễu jsdom "navigation not implemented".

## Rủi ro phải giữ khi hợp nhất

Đọc kỹ trước khi sửa, vì đây là thứ dễ đánh rơi nhất:

- `table-cell-editors.tsx` có `stopRowNavigation`. Ô trong bảng không được kích hoạt điều hướng hàng khi người dùng mở picker. Hợp nhất mà làm rơi cái này là hồi quy trực tiếp: bấm để đổi trạng thái sẽ nhảy sang trang chi tiết.
- Ba nơi có ba chữ ký khác nhau. Hàng loạt nhận `onUpdate(updates)` gộp nhiều trường; một-giá-trị muốn `value` + `onChange`. Interface chung phải phục vụ cả hai mà không ép bên nào vặn vẹo.
- `properties-sidebar.tsx` dùng cả `DropdownMenu` lẫn `Select`. Tìm hiểu vì sao có hai kiểu trước khi thống nhất; có thể một trong hai đang phục vụ một ràng buộc bạn chưa thấy.

## Cấu trúc file đích

| File | Trách nhiệm |
| --- | --- |
| `packages/views/tasks/pickers/enum-field-picker.tsx` (mới) | Chọn một giá trị từ danh sách hữu hạn; nền cho status và priority |
| `packages/views/tasks/pickers/status-picker.tsx` (mới) | Trạng thái, bọc enum picker kèm nhãn và màu |
| `packages/views/tasks/pickers/priority-picker.tsx` (mới) | Độ ưu tiên, tương tự |
| `packages/views/tasks/pickers/assignee-picker.tsx` (mới) | Người phụ trách, có tìm kiếm |
| `packages/views/tasks/pickers/date-picker.tsx` (mới) | Một ngày, dùng `calendar`; phục vụ cả hạn và ngày bắt đầu |
| `packages/views/tasks/pickers/label-picker.tsx` (mới) | Nhãn, chọn nhiều |
| `packages/views/tasks/pickers/index.ts` (mới) | Một cửa ra vào |
| `packages/views/tasks/row-actions-menu.tsx` (mới) | Menu hành động trên hàng và menu chuột phải |

## Task 1: Rút picker trường liệt kê và chuyển ba nơi sang dùng

Bắt đầu bằng status và priority vì chúng là danh sách hữu hạn thuần, không cần dữ liệu server, nên rủi ro thấp nhất và lộ ra ngay interface chung có đủ dùng cho cả ba nơi hay không.

**Files:**
- Create: `packages/views/tasks/pickers/enum-field-picker.tsx`, `status-picker.tsx`, `priority-picker.tsx`, `index.ts`
- Modify: `packages/views/tasks/modes/table-cell-editors.tsx`, `packages/views/tasks/detail/components/properties-sidebar.tsx`, `packages/views/tasks/views/batch-pickers.tsx`
- Test: `packages/views/tasks/pickers/enum-field-picker.test.tsx`

**Interfaces:**
- Produces:
```ts
export type EnumOption = { value: string; label: string; icon?: ReactNode };
export function EnumFieldPicker(props: {
  value: string | null;
  options: EnumOption[];
  onChange: (value: string) => void;
  disabled?: boolean;
  /** Nhãn cho trình đọc màn hình; bắt buộc vì trigger thường chỉ có icon. */
  ariaLabel: string;
  /** Ô trong bảng truyền vào để chặn điều hướng hàng. */
  onTriggerPointerDown?: (event: SyntheticEvent) => void;
  children: ReactNode;
}): JSX.Element;
```
Task 2 đến 4 dùng lại đúng khuôn prop này cho các họ trường khác.

- [ ] **Step 1: Đọc ba bản cài đặt hiện có trước khi viết gì**

Đọc hết `batch-pickers.tsx`, phần status/priority của `table-cell-editors.tsx`, và phần status/priority của `properties-sidebar.tsx`. Ghi lại trong báo cáo: mỗi nơi khác nhau ở điểm nào, và điểm khác nào là **có lý do** chứ không phải trôi dạt. Nếu bạn thấy một khác biệt mà không giải thích được, hỏi lại trước khi hợp nhất — hợp nhất một khác biệt có chủ đích là cách chắc chắn để tạo hồi quy.

- [ ] **Step 2: Viết test thất bại cho picker chung**

```tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { EnumFieldPicker } from "./enum-field-picker";

initI18n();

const options = [
  { value: "todo", label: "Cần làm" },
  { value: "doing", label: "Đang làm" },
];

describe("EnumFieldPicker", () => {
  it("gọi onChange với giá trị được chọn", () => {
    const onChange = vi.fn();
    render(
      <EnumFieldPicker value="todo" options={options} onChange={onChange} ariaLabel="Trạng thái">
        Trạng thái
      </EnumFieldPicker>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Trạng thái" }));
    fireEvent.click(screen.getByText("Đang làm"));
    expect(onChange).toHaveBeenCalledWith("doing");
  });

  it("không gọi onChange khi disabled", () => {
    const onChange = vi.fn();
    render(
      <EnumFieldPicker value="todo" options={options} onChange={onChange} disabled ariaLabel="Trạng thái">
        Trạng thái
      </EnumFieldPicker>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Trạng thái" }));
    expect(onChange).not.toHaveBeenCalled();
  });

  it("chuyển tiếp sự kiện con trỏ trên trigger cho nơi gọi", () => {
    const onTriggerPointerDown = vi.fn();
    render(
      <EnumFieldPicker
        value="todo"
        options={options}
        onChange={vi.fn()}
        ariaLabel="Trạng thái"
        onTriggerPointerDown={onTriggerPointerDown}
      >
        Trạng thái
      </EnumFieldPicker>,
    );
    fireEvent.pointerDown(screen.getByRole("button", { name: "Trạng thái" }));
    expect(onTriggerPointerDown).toHaveBeenCalled();
  });
});
```

Ca thứ ba là ca giữ `stopRowNavigation` sống sót qua đợt hợp nhất. Đừng bỏ nó.

- [ ] **Step 3: Chạy test để thấy nó thất bại**

```bash
cd packages/views && NODE_OPTIONS="--no-experimental-webstorage" npx vitest run --coverage=false tasks/pickers/enum-field-picker.test.tsx
```

Kỳ vọng: FAIL, không resolve được module.

- [ ] **Step 4: Viết picker chung**

Dùng `DropdownMenu` với `DropdownMenuRadioGroup` như `batch-pickers.tsx` đang dùng, vì đó là khuôn đã có trong chính thư mục tasks. Trigger nhận `children` để nơi gọi tự quyết hiển thị, và `ariaLabel` đi vào `aria-label` của trigger. `disabled` dùng `aria-disabled` chứ không dùng thuộc tính `disabled` thô, theo hợp đồng khả năng tiếp cận của repo: nút phải ở lại trong thứ tự tab và hành động bị chặn bằng JS.

- [ ] **Step 5: Viết status và priority bọc ngoài**

Mỗi file lấy danh sách từ `TASK_STATUSES` / `TASK_PRIORITIES` trong `@uniwork/core/types` và dịch nhãn bằng khóa i18n đã có (`tasks.status_*`, `tasks.priority_*`). Không thêm khóa mới nếu khóa cũ đã đủ.

- [ ] **Step 6: Chuyển ba nơi tiêu thụ sang dùng**

Sửa `batch-pickers.tsx`, phần status/priority của `table-cell-editors.tsx`, và phần status/priority của `properties-sidebar.tsx` để chúng gọi picker chung. Giữ nguyên chữ ký ra ngoài của từng nơi — `BatchStatusPicker` vẫn nhận `onUpdate`, ô bảng vẫn nhận thứ nó đang nhận — chỉ thay phần ruột. Đây là điều giữ cho task này không lan ra ngoài.

Với ô bảng, truyền `onTriggerPointerDown={stopRowNavigation}`.

- [ ] **Step 7: Chạy test và kiểm hồi quy**

```bash
cd packages/views && NODE_OPTIONS="--no-experimental-webstorage" npx vitest run --coverage=false tasks/
```

Toàn bộ thư mục tasks phải xanh. Nếu một test cũ hỏng, đọc kỹ: nó có thể đang ghim đúng một khác biệt có chủ đích mà bạn vừa hợp nhất mất.

- [ ] **Step 8: Commit**

```bash
git add packages/views/tasks
git commit -m "refactor(tasks): một picker trạng thái và độ ưu tiên cho cả ba nơi dùng"
```

## Task 2: Người phụ trách

Khó hơn task 1 vì cần dữ liệu thành viên và cần tìm kiếm.

**Files:**
- Create: `packages/views/tasks/pickers/assignee-picker.tsx`
- Modify: ba nơi tiêu thụ như task 1
- Test: `packages/views/tasks/pickers/assignee-picker.test.tsx`

**Interfaces:**
- Consumes: `EnumFieldPicker` nếu hợp, nhưng đừng ép — danh sách thành viên có tìm kiếm và avatar, nên `Combobox` hoặc `Command` có thể đúng hơn. Chọn và giải thích trong báo cáo.
- Produces: `AssigneePicker` với `value: string | null`, `onChange: (id: string | null) => void`, và một cách bỏ gán.

- [ ] **Step 1: Đọc hai picker thành viên đã có**

`packages/views/chat/workspace-member-picker.tsx` và `packages/views/meetings/member-multi-picker.tsx`. Một trong hai có thể dùng lại gần như nguyên vẹn. Nếu có, dùng lại và nói rõ; đừng viết bản thứ ba chỉ vì nó nằm ở thư mục khác.

- [ ] **Step 2: Viết test thất bại**

Phủ: chọn một thành viên gọi `onChange` với id; bỏ gán gọi `onChange(null)`; gõ vào ô tìm kiếm lọc danh sách; và bàn phím đi được hết danh sách rồi chọn bằng Enter.

- [ ] **Step 3 đến 6: như task 1**

Chạy đỏ, viết, chuyển ba nơi, chạy lại toàn thư mục tasks.

- [ ] **Step 7: Commit**

```bash
git commit -m "refactor(tasks): một picker người phụ trách cho cả ba nơi dùng"
```

## Task 3: Ngày

Bảng đã có `TableDueDateCell`. Sidebar và hàng loạt chưa có ngày nào. Ngày bắt đầu chưa có ở đâu cả.

**Files:**
- Create: `packages/views/tasks/pickers/date-picker.tsx`
- Modify: `table-cell-editors.tsx`, `properties-sidebar.tsx`
- Modify: `packages/core/i18n/locales/vi.json`, `en.json`
- Test: `packages/views/tasks/pickers/date-picker.test.tsx`

**Interfaces:**
- Produces: `TaskDatePicker` với `value: string | null` dạng `YYYY-MM-DD`, `onChange: (value: string | null) => void`, `ariaLabel: string`, và cách xoá ngày.

- [ ] **Step 1: Viết test thất bại**

Phủ bốn điều: chọn một ngày gọi `onChange` với `YYYY-MM-DD`; xoá gọi `onChange(null)`; giá trị `null` hiển thị nhãn trống chứ không hiện chuỗi rỗng; và một chuỗi ngày không hợp lệ từ server không làm sập component.

Ca cuối quan trọng: schema của repo cố ý lỏng, nên UI phải chịu được dữ liệu trôi.

- [ ] **Step 2: Chạy đỏ, rồi viết bằng `calendar` primitive**

Múi giờ là cái bẫy ở đây. Ngày hạn là ngày theo lịch, không phải mốc thời gian. Chuyển đổi phải giữ nguyên ngày người dùng thấy dù trình duyệt ở múi nào. Nói rõ trong báo cáo bạn xử ra sao, và viết một test cho nó.

- [ ] **Step 3: Nối vào bảng và sidebar, thêm ngày bắt đầu**

- [ ] **Step 4: Chạy test và commit**

```bash
git commit -m "feat(tasks): picker ngày hạn và ngày bắt đầu"
```

## Task 4: Nhãn

**Files:**
- Create: `packages/views/tasks/pickers/label-picker.tsx`
- Modify: `table-cell-editors.tsx`, `properties-sidebar.tsx`
- Test: `packages/views/tasks/pickers/label-picker.test.tsx`

- [ ] **Step 1: Đọc `TableLabelsCell` và `member-multi-picker.tsx`**

Bảng đã hiển thị nhãn; xem nó đang làm gì và có cho sửa không. `member-multi-picker` là khuôn chọn nhiều gần nhất trong repo.

- [ ] **Step 2: Viết test thất bại**

Phủ: thêm một nhãn gọi đúng hàm với id nhãn; bỏ một nhãn gọi đúng hàm; danh sách rỗng hiện trạng thái rỗng chứ không hiện khung trắng; và chọn nhiều rồi đóng không làm mất lựa chọn.

- [ ] **Step 3 đến 5: chạy đỏ, viết, nối vào bảng và sidebar, chạy lại**

- [ ] **Step 6: Commit**

```bash
git commit -m "feat(tasks): picker nhãn dùng chung cho bảng và sidebar"
```

## Task 5: Menu hành động trên hàng và menu chuột phải

**Files:**
- Create: `packages/views/tasks/row-actions-menu.tsx`
- Modify: `packages/views/tasks/modes/list-row.tsx`, `packages/views/tasks/modes/table-view.tsx`, `packages/views/tasks/modes/board-card.tsx`
- Modify: `packages/core/i18n/locales/vi.json`, `en.json`
- Test: `packages/views/tasks/row-actions-menu.test.tsx`

- [ ] **Step 1: Kiểm primitive**

`packages/ui/components/ui/` có `dropdown-menu` nhưng có thể chưa có `context-menu`. Nếu chưa, thêm bằng `pnpm ui:add context-menu` chứ đừng tự dựng. Nói rõ trong báo cáo bạn đã thêm gì.

- [ ] **Step 2: Viết test thất bại**

Phủ: menu mở bằng chuột phải; cùng bộ hành động mở được bằng nút ba chấm cho người dùng bàn phím; mỗi hành động gọi đúng callback; và hành động xoá hỏi xác nhận chứ không xoá thẳng.

Ca cuối là ranh giới sản phẩm, không phải kỹ thuật: xoá một công việc không được là một cú bấm nhầm.

- [ ] **Step 3 đến 5: chạy đỏ, viết, nối vào ba chế độ xem, chạy lại**

Hành động tối thiểu: mở chi tiết, sao chép liên kết, đổi trạng thái, đổi người phụ trách, xoá. Dùng lại picker từ task 1 và 2 cho hai hành động giữa thay vì dựng menu con riêng.

- [ ] **Step 6: Commit**

```bash
git commit -m "feat(tasks): menu hành động trên hàng và menu chuột phải"
```

## Task 6: Cổng cuối và tài liệu

- [ ] **Step 1: Chạy cổng đầy đủ**

```bash
NODE_OPTIONS="--no-experimental-webstorage" make check
```

Đọc output, đừng chỉ nhìn mã thoát. Đối chiếu mọi lỗi với danh sách lỗi nền ở Global Constraints.

- [ ] **Step 2: Kiểm cân bằng i18n**

- [ ] **Step 3: Nâng sàn coverage**

Nâng đúng con số đạt được. Sàn không bao giờ đi xuống; nếu số nào thấp hơn, dừng và báo cáo.

- [ ] **Step 4: Cập nhật tài liệu**

Đổi trạng thái plan này thành shipped; ghi lát C shipped vào spec; giữ F-05 ở `MỘT PHẦN` và thêm ghi chú. Thêm vào mục "Giới hạn đã biết" của spec: picker thuộc tính tùy biến nằm ngoài lát C vì nó là nối dây cả một danh mục, và hai nơi khác trong repo đang chờ cùng năng lực đó.

- [ ] **Step 5: Commit. KHÔNG mở pull request.**

## Một chỗ plan này cố ý lệch khuôn

Khuôn plan của repo đòi mỗi bước có mã thật, không được viết "giống task N". Task 1 có đủ mã.
Task 2 đến 5 thì không: chúng chỉ nêu **những gì test phải phủ**, bằng lời.

Đó là lựa chọn có chủ đích. Người viết plan này chưa đọc kỹ `workspace-member-picker.tsx`,
`member-multi-picker.tsx` và `TableLabelsCell`, nên mọi khối mã viết sẵn cho chúng sẽ là
phỏng đoán trông giống thật. Một plan bịa mã tệ hơn một plan nói thẳng là chưa biết: người
thực thi sẽ tin khối mã đó và đi sai, thay vì đọc file rồi tự viết đúng.

Bù lại, mỗi task ở đây bắt đầu bằng một bước ĐỌC có tên file cụ thể, và danh sách ca test
được nêu đủ chi tiết để không ai phải đoán ý định. Nếu lúc thực thi thấy khuôn prop của task
1 không hợp với họ trường của mình, hãy nói ra thay vì bẻ cong nó cho vừa.

## Ghi chú cho người thực thi

- Thứ tự phụ thuộc: task 1 tạo khuôn prop cho task 2 đến 4. Task 5 dùng lại task 1 và 2. Task 6 cuối cùng.
- Mỗi task chuyển cả ba nơi tiêu thụ cùng lúc. Đừng để một nơi dùng bản mới còn hai nơi dùng bản cũ qua nhiều task — đó là lúc hai hành vi lặng lẽ tách đôi.
- Luôn đọc bản hiện tại trên đĩa. Lát A và B đã đổi `timeline.tsx` và thư mục `detail/` khá nhiều.
