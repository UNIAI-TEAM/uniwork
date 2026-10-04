import { describe, expect, it } from "vitest";
import { fittingGroupCount, hiddenGroupIndexes, visibleGroupIndexes, type OverflowInput } from "./index";

const WIDE = { containerWidth: 1000, overflowButtonWidth: 36 } satisfies Partial<OverflowInput>;

describe("overflow: quyết định nhóm nào ở lại hàng lệnh", () => {
  it("giữ mọi nhóm khi cả hàng vừa", () => {
    const input: OverflowInput = { groupWidths: [100, 200, 120], ...WIDE };
    expect(fittingGroupCount(input)).toBe(3);
    expect(visibleGroupIndexes(input)).toEqual([0, 1, 2]);
    expect(hiddenGroupIndexes(input)).toEqual([]);
  });

  it("đẩy NGUYÊN nhóm sang » khi thiếu chỗ, không cắt vụn nhóm", () => {
    const input = { groupWidths: [300, 300, 300], containerWidth: 700, overflowButtonWidth: 36, separatorWidth: 8 };
    expect(visibleGroupIndexes(input)).toEqual([0, 1]);
    expect(hiddenGroupIndexes(input)).toEqual([2]);
  });

  it("không trả tiền cho » khi nó chẳng giấu nhóm nào", () => {
    // 3 nhóm vừa khít (916/936): giữ đủ 3, không dựng menu rỗng.
    const input = { groupWidths: [300, 300, 300], containerWidth: 936, overflowButtonWidth: 36, separatorWidth: 8 };
    expect(visibleGroupIndexes(input)).toEqual([0, 1, 2]);
    expect(hiddenGroupIndexes(input)).toEqual([]);
  });

  it("bỏ thêm đúng một nhóm khi » cần chỗ mà nhóm cuối đang chiếm", () => {
    const input = { groupWidths: [300, 300, 300], containerWidth: 640, overflowButtonWidth: 36, separatorWidth: 8 };
    expect(visibleGroupIndexes(input)).toEqual([0]);
    expect(hiddenGroupIndexes(input)).toEqual([1, 2]);
  });

  it("coi » là 0 rộng thì không nhóm nào bị đẩy đi", () => {
    const input = { groupWidths: [400, 400], containerWidth: 820, overflowButtonWidth: 0, separatorWidth: 8 };
    expect(visibleGroupIndexes(input)).toEqual([0, 1]);
    expect(hiddenGroupIndexes(input)).toEqual([]);
  });

  it("ngân sách » bằng 0 vẫn không giấu nhóm nào: không có chỗ thì không dựng menu", () => {
    // Nếu hàm vẫn đẩy nhóm sang » trong khi component không dựng » (bề rộng 0),
    // nhóm đó biến mất khỏi hàng mà không có menu nào chứa nó.
    const input = { groupWidths: [400, 400], containerWidth: 820, overflowButtonWidth: 0, separatorWidth: 8 };
    expect(fittingGroupCount(input)).toBe(2);
    expect(hiddenGroupIndexes(input)).toEqual([]);
  });

  it("nhóm đầu tiên rộng hơn hàng thì mọi nhóm vào »", () => {
    const input = { groupWidths: [900, 300], containerWidth: 400, overflowButtonWidth: 36, separatorWidth: 8 };
    expect(visibleGroupIndexes(input)).toEqual([]);
    expect(hiddenGroupIndexes(input)).toEqual([0, 1]);
  });

  it("hàng rỗng thì không có gì để giấu", () => {
    const input = { groupWidths: [], containerWidth: 400, overflowButtonWidth: 36 };
    expect(fittingGroupCount(input)).toBe(0);
    expect(visibleGroupIndexes(input)).toEqual([]);
    expect(hiddenGroupIndexes(input)).toEqual([]);
  });

  it("hàng chưa đo (bề rộng 0) giữ đủ nhóm thay vì giấu hết trong một khung hình", () => {
    const input = { groupWidths: [300, 300], containerWidth: 0, overflowButtonWidth: 36 };
    expect(fittingGroupCount(input)).toBe(2);
    expect(visibleGroupIndexes(input)).toEqual([0, 1]);
    expect(hiddenGroupIndexes(input)).toEqual([]);
  });
});
