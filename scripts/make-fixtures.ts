/* Generates dummy workbooks (no real figures). Run: npm run make-fixtures */
import * as XLSX from 'xlsx';
import * as fs from 'node:fs';
import { mkdirSync } from 'node:fs';

XLSX.set_fs(fs);

type C = { v?: string | number | Date; f?: string };
type Cell = C | string | number | Date;
function sheet(cells: Record<string, Cell>): XLSX.WorkSheet {
  const ws: XLSX.WorkSheet = {};
  let maxR = 0, maxC = 0;
  for (const [a, raw] of Object.entries(cells)) {
    const c: C = typeof raw === 'object' && !(raw instanceof Date) ? raw : { v: raw };
    const { r, c: cc } = XLSX.utils.decode_cell(a);
    maxR = Math.max(maxR, r); maxC = Math.max(maxC, cc);
    const t = c.v instanceof Date ? 'd' : typeof c.v === 'number' ? 'n' : 's';
    ws[a] = { t, v: c.v as any, ...(c.f ? { f: c.f } : {}) } as XLSX.CellObject;
  }
  ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: maxR, c: maxC } });
  return ws;
}

mkdirSync('fixtures', { recursive: true });

// ── Format A: "Money Plan" (take-home 4000, dummy)
const plan: [string, string, number, string?][] = [
  ['1. Give', 'Charity', 100, '=B3*B4'],
  ['2. Fixed needs', 'Car loan', 400],
  ['', 'Car insurance', 150, '=1800/12'],
  ['', 'Petrol', 200],
  ['', 'Road tax', 7.5, '=90/12'],
  ['', 'Phone bill', 70],
  ['', 'Food', 500],
  ['3. Sinking funds', 'Car wear & tear', 50, '=(1000/5+400/2)/12'],
  ['', 'Gifts & family occasions', 100],
  ['4. Creator business', 'Business tools', 150],
  ['5. Safety then wealth', 'Emergency fund top-up (ASB)', 600],
  ['', 'Long-term investing', 1372.5, '=B3-SUM(C9:C20)'],
  ['6. Guilt-free', 'Recreation', 300],
];
const A: Record<string, Cell> = {
  A1: 'Money Plan', A3: 'Take-home salary (RM)', B3: 4000, A4: 'Giving % of income', B4: 0.025,
  A5: 'Emergency fund target (months of fixed costs)', B5: 6, A6: 'Emergency fund balance now (RM)', B6: 3000,
  A7: 'Plan start month', B7: new Date(2026, 9, 1),
  A8: 'Pocket', B8: 'Item', C8: 'Planned (RM)',
};
plan.forEach(([pocket, item, amt, f], i) => {
  const r = 9 + i;
  if (pocket) A[`A${r}`] = pocket;
  A[`B${r}`] = item;
  A[`C${r}`] = f ? { v: amt, f: f.slice(1) } : amt;
});
A[`B${9 + plan.length}`] = 'Total';
A[`C${9 + plan.length}`] = 4000;

// ── Format B: older "Actual Budgeting" layout (dummy, same quirks: summary copies, combined rows, duplicate)
const B: Record<string, Cell> = {
  A1: 'Total Nett Salary: ', B1: 4000, D1: 'Remaining:', E1: { v: 769.16, f: 'B1-D3' },
  A5: 'Pocket', B5: 'Amount (RM)', C5: 'Yearly (RM)',
  A6: 'Therapy', B6: 300, C6: { v: 3600, f: 'B6*12' },
  A7: 'Co-Sharing Space', B7: 200,
  A8: 'Recreation', B8: 250,
  A9: 'Food (Office)', B9: 180,
  A10: 'Car Loan Payment', B10: 400,
  A11: 'Total', B11: 1330,
  A13: 'Pocket', B13: 'Amount (RM)',
  A14: 'ASNB Savings', B14: 1000, A15: 'Youtube & Business', B15: 300, A16: 'Total', B16: 1300,
  F5: 'Item', G5: 'Amount (RM)', H5: 'Yearly (RM)',
  F6: 'Haircut', G6: 20,
  F7: 'Car Insurance', G7: { v: 150, f: 'H7/12' }, H7: 1800,
  F8: 'Road Tax', G8: 7.5,
  F9: 'PTPTN & MARA', G9: 200,
  F10: 'AI', G10: 100,
  F11: 'Electric and Donate', G11: 90,
  F12: 'Total', G12: 567.5,
  M5: 'Category', N5: 'Amount', O5: '% Of Salary',
  M6: 'Food (Office)', N6: { v: 180, f: 'B9' },
  M7: 'Car Loan Payment', N7: { v: 400, f: 'B10' },
  M8: 'Haircut', N8: { v: 20, f: 'G6' },
  M9: 'Youtube & Business', N9: 300,
  M10: 'Total', N10: 900,
  S5: 'Item', T5: 'Amount', U5: 'Yearly',
  S6: 'PTPTN', T6: { v: 120, f: 'G9-Y7' }, S7: 'MARA', T7: { v: 80, f: 'G9-Y6' },
  S8: '(AI) Claude', T8: { v: 100, f: 'G10' },
  S9: 'Total', T9: 300,
  X5: 'Item', Y5: 'Amount', Z5: 'Total',
  X6: 'PTPTN', Y6: 120, Z6: { v: 200, f: 'Y6+Y7' }, X7: 'MARA', Y7: 80, X8: 'Claude', Y8: 100,
  F15: 'Item', G15: 'Amount (RM)', H15: 'Yearly (RM)', J15: 'Full Payment (RM)', K15: 'Recurrence (in Years)',
  F16: 'Absorber', G16: { v: 16.67, f: 'H16/12' }, H16: { v: 200, f: 'J16/K16' }, J16: 1000, K16: 5,
  F17: 'Brake Pad', G17: { v: 16.67, f: 'H17/12' }, H17: { v: 200, f: 'J17/K17' }, J17: 1000, K17: 5,
  F18: 'Tires',
  F19: 'Total', G19: 33.34,
};
// A second sheet that must be ignored (another month)
const other = sheet({ A1: 'Total Nett Salary: ', B1: 3900, A4: 'Pocket', B4: 'Amount (RM)', A5: 'Therapy', B5: 200 });

const wbA = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wbA, sheet(A), 'Money Plan');
XLSX.writeFile(wbA, 'fixtures/money-plan.xlsx', { cellDates: true });

const wbB = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wbB, sheet(B), 'Actual Budgeting');
XLSX.utils.book_append_sheet(wbB, other, 'July');
XLSX.writeFile(wbB, 'fixtures/actual-budgeting.xlsx', { cellDates: true });
console.log('Wrote fixtures/money-plan.xlsx and fixtures/actual-budgeting.xlsx');
