// Board ordering: float positions với midpoint insertion (kiểu Linear/usf).
// overIndex = vị trí muốn chèn trong danh sách đích (0..len).
export function computeDropPosition(
  rows: { id: string; position: number }[],
  overIndex: number,
): number {
  if (rows.length === 0) return 1024;
  if (overIndex <= 0) return rows[0]!.position / 2;
  if (overIndex >= rows.length) return rows[rows.length - 1]!.position + 1024;
  return (rows[overIndex - 1]!.position + rows[overIndex]!.position) / 2;
}
