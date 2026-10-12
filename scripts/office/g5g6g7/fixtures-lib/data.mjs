// Synthetic business data shared by every fixture, so the six formats tell one consistent story.
// X = quantity, Y = unit price (VND), Z = discount. Z is stored two ways on purpose: the plain number 10
// (meaning 10 percent) and 10% (stored as 0.1 with a percent number format).

export const SHEET_Q1 = 'Doanh thu Q1';
export const SHEET_Q2 = 'Doanh thu Q2';
export const SHEET_SUMMARY = 'Tổng hợp';
export const SHEET_NOTES = 'Ghi chú';

export const REGIONS = ['Bắc', 'Nam', 'Trung'];

// zKind: 'pct' = stored as a fraction with a percent format, 'plain' = stored as a plain number (10 means 10%),
// 'blank' = the cell exists but is empty.
export const ORDERS = {
  [SHEET_Q1]: [
    { id: 'Q1-001', region: 'Bắc', product: 'Áo thun', x: 100, y: 50000, z: 0.1, zKind: 'pct' },
    { id: 'Q1-002', region: 'Bắc', product: 'Quần jeans', x: 40, y: 120000, z: 0.05, zKind: 'pct' },
    { id: 'Q1-003', region: 'Nam', product: 'Áo thun', x: 80, y: 50000, z: 10, zKind: 'plain' },
    { id: 'Q1-004', region: 'Nam', product: 'Quần jeans', x: 30, y: 120000, z: null, zKind: 'blank' },
    { id: 'Q1-005', region: 'Trung', product: 'Mũ lưỡi trai', x: 200, y: 20000, z: 0.15, zKind: 'pct', hidden: true },
    { id: 'Q1-006', region: 'Trung', product: 'Quần jeans', x: 25, y: 120000, z: 0.2, zKind: 'pct' },
  ],
  [SHEET_Q2]: [
    { id: 'Q2-001', region: 'Bắc', product: 'Áo thun', x: 120, y: 50000, z: 0.1, zKind: 'pct' },
    { id: 'Q2-002', region: 'Bắc', product: 'Quần jeans', x: 50, y: 120000, z: 0.05, zKind: 'pct' },
    { id: 'Q2-003', region: 'Nam', product: 'Áo thun', x: 90, y: 50000, z: 10, zKind: 'plain' },
    { id: 'Q2-004', region: 'Trung', product: 'Mũ lưỡi trai', x: 0, y: 20000, z: null, zKind: 'blank' },
    { id: 'Q2-005', region: 'Trung', product: 'Quần jeans', x: 35, y: 120000, z: 0.2, zKind: 'pct', hidden: true },
  ],
};

/** Discount as a fraction: blank is 0, a plain number above 1 is a percentage written as a number. */
export const discountFraction = (z) => (z === null ? 0 : z > 1 ? z / 100 : z);

export const revenueOf = (order) => Math.round(order.x * order.y * (1 - discountFraction(order.z)));

const sum = (values) => values.reduce((a, b) => a + b, 0);
const round6 = (n) => Number(n.toFixed(6));

export function sheetTotals(orders) {
  const visible = orders.filter((o) => !o.hidden);
  const all = (pick) => sum(orders.map(pick));
  const vis = (pick) => sum(visible.map(pick));
  return {
    rowCount: orders.length,
    hiddenRowCount: orders.length - visible.length,
    withHiddenRows: {
      sumX: all((o) => o.x),
      sumY: all((o) => o.y),
      sumZStored: round6(all((o) => o.z ?? 0)),
      revenue: all(revenueOf),
    },
    withoutHiddenRows: {
      sumX: vis((o) => o.x),
      sumY: vis((o) => o.y),
      sumZStored: round6(vis((o) => o.z ?? 0)),
      revenue: vis(revenueOf),
    },
  };
}

export function regionTotals() {
  return REGIONS.map((region) => {
    const q1 = sum(ORDERS[SHEET_Q1].filter((o) => o.region === region).map(revenueOf));
    const q2 = sum(ORDERS[SHEET_Q2].filter((o) => o.region === region).map(revenueOf));
    return { region, q1, q2, total: q1 + q2 };
  });
}

export const grandTotals = () => {
  const rows = regionTotals();
  return { q1: sum(rows.map((r) => r.q1)), q2: sum(rows.map((r) => r.q2)), total: sum(rows.map((r) => r.total)) };
};

/** Vietnamese grouping: 1.234.567 */
export const fmtVi = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
/** Vietnamese percent with one decimal: 41,1% */
const fmtPct = (fraction) => `${(fraction * 100).toFixed(1).replace('.', ',')}%`;

/** Q1 share of each region in Q1 revenue, as shown by the DOCX/PPTX/MD/HTML fixtures. */
export function q1Shares() {
  const rows = regionTotals();
  const total = sum(rows.map((r) => r.q1));
  return rows.map((r) => ({ region: r.region, revenue: r.q1, share: r.q1 / total, shareText: fmtPct(r.q1 / total) }));
}

export const Q1_TOTAL = () => grandTotals().q1;

export const REPORT_TABLE_HEADER = ['Khu vực', 'Doanh thu Q1 (đồng)', 'Tỷ trọng'];

export function reportTableRows() {
  const shares = q1Shares();
  return [
    ...shares.map((s) => [s.region, fmtVi(s.revenue), s.shareText]),
    ['Tổng cộng', fmtVi(Q1_TOTAL()), '100,0%'],
  ];
}
