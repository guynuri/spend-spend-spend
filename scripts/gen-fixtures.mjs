// Generates synthetic bank fixtures (PLAN §14). All data is invented; the account number is fake.
// Run: npm run gen:fixtures   → fixtures/otsar-hahayal/synthetic/*
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
const XLSX = require('xlsx');
const cpexcel = require('xlsx/dist/cpexcel.js');

const OUT = 'fixtures/otsar-hahayal/synthetic';
mkdirSync(OUT, { recursive: true });

// ---- deterministic master ledger: 2026-10-01 … 2026-11-14 ----
let seed = 7;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const pick = (a) => a[Math.floor(rnd() * a.length)];
const serial = (iso) => Math.round((Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) - Date.UTC(1899, 11, 30)) / 86400000);
const ddmmyyyy = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
const ddmmyy = (iso) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(2, 4)}`;
const day = (m, d) => `2026-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
let ref = 401000;
const rows = [];
const add = (date, desc, op, amount, r = ++ref) => rows.push({ date, desc, op, amount, ref: String(r) });
for (const m of [10, 11]) {
  const last = m === 10 ? 31 : 14;
  for (let d = 1; d <= last; d++) {
    const dt = day(m, d);
    if (d === 1) {
      add(dt, 'משכורת אלפא מערכות     ', 'משכורת', 1450000);
      add(dt, 'שכר דירה', 'הוראת קבע', -520000);
      add(dt, 'מעון הדקל', 'הוראת קבע', -290000);
    }
    if (d === 3) add(dt, 'בזק בינלאומי', 'הוראת קבע', -9900);
    if (d === 5) add(dt, 'הראל ביטוח', 'הוראת קבע', -41000);
    if (d === 10) {
      add(dt, 'ישראכרט', 'חיוב כרטיס אשראי', m === 10 ? -743210 : -812345);
      add(dt, 'משכורת עמותת בטא', 'משכורת', 980000);
    }
    if (d === 12) add(dt, 'חברת החשמל', 'הוראת קבע', -31250);
    if (d === 14) {
      add(dt, 'העברה ב-bit', 'העברה', -5000, 777001 + m);
      add(dt, 'העברה ב-bit', 'העברה', -5000, 777001 + m); // identical same-day row
    }
    if (d === 15) add(dt, 'הלוואה פירעון', 'הלוואה', -125000);
    if (d === 20) add(dt, 'ביטוח לאומי קצבת ילדים', 'זיכוי', 17300);
    if (d % 3 === 0) add(dt, 'שופרסל דיל        ', 'כרטיס חיוב', -Math.round(8000 + rnd() * 30000));
    if (d % 7 === 2) add(dt, 'משיכת מזומן כספומט', 'משיכת מזומן', -pick([20000, 30000, 50000]));
    if (d % 5 === 4) add(dt, pick(['פז יילו', 'סופר פארם', 'קפה לנדוור', 'רמי לוי']), 'כרטיס חיוב', -Math.round(2500 + rnd() * 15000));
    if (d % 2 === 0 && d % 10 !== 0) add(dt, pick(['ארומה תל אביב', 'סונול', 'אושר עד', 'גולדה גלידה', 'yes פלאנט']), 'כרטיס חיוב', -Math.round(1500 + rnd() * 9000));
    if (d === 28 && m === 10) add(dt, 'עמלת ניהול חשבון', 'עמלה', -1250);
  }
}
let bal = 1234567;
for (const r of rows) r.balanceTrue = bal += r.amount;
// zero on all but the last row of each day
rows.forEach((r, i) => (r.balance = rows[i + 1] && rows[i + 1].date === r.date ? 0 : r.balanceTrue));

const HEAD = [null, 'יתרה', 'תאריך ערך', 'זכות', 'חובה', 'תיאור', 'אסמכתא', 'סוג פעולה', 'תאריך'];
const dataRow = (r, dateFn = serial) => [null, r.balance, dateFn(r.date), r.amount > 0 ? r.amount / 100 : 0, r.amount < 0 ? -r.amount / 100 : 0, r.desc, r.ref, r.op, dateFn(r.date)];
const meta = (from, to, extra = 0) => [
  [null, 'תנועות בחשבון עו"ש'],
  [null, 'מספר חשבון: 99-123-456789', 'הופק בתאריך 15/11/2026 09:12'],
  [null, 'סוג חשבון: עובר ושב'],
  [null, `מתאריך ${ddmmyyyy(from)} עד תאריך ${ddmmyyyy(to)}`],
  ...Array.from({ length: extra }, () => [null, 'שורת מידע']),
  [],
];
const toSheet = (aoa) => {
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!dir'] = 'rtl';
  return ws;
};
const writeBook = (file, aoa, bookType = 'xlsx') => {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, toSheet(aoa), 'דוח');
  writeFileSync(`${OUT}/${file}`, XLSX.write(wb, { bookType, type: 'buffer' }));
};
const fmtBal = (r) => (r.balance === 0 ? 0 : r.balance / 100);
const withBal = (r) => ({ ...r, balance: fmtBal(r) });

const oct = rows.filter((r) => r.date <= '2026-10-31').map(withBal);
const overlap = rows.filter((r) => r.date >= '2026-10-15').map(withBal);
const expected = {};
const summarize = (rs) => ({
  rows: rs.length,
  sumMinor: rs.reduce((a, r) => a + r.amount, 0),
  inMinor: rs.filter((r) => r.amount > 0).reduce((a, r) => a + r.amount, 0),
  outMinor: rs.filter((r) => r.amount < 0).reduce((a, r) => a - r.amount, 0),
  first: rs[0].date,
  last: rs[rs.length - 1].date,
  closing: (() => {
    const l = [...rs].reverse().find((r) => r.balance !== 0);
    return l ? { date: l.date, minor: l.balanceTrue } : null;
  })(),
});

// 1) main October file, newest first
writeBook('otsar_2026-10.xlsx', [...meta('2026-10-01', '2026-10-31'), HEAD, ...[...oct].reverse().map((r) => dataRow(r))]);
expected['otsar_2026-10.xlsx'] = { ...summarize(rows.filter((r) => r.date <= '2026-10-31')), period: { from: '2026-10-01', to: '2026-10-31' }, mask: '6789', errors: 0 };
// 2) same in BIFF8 .xls
writeBook('otsar_2026-10.xls', [...meta('2026-10-01', '2026-10-31'), HEAD, ...[...oct].reverse().map((r) => dataRow(r))], 'biff8');
expected['otsar_2026-10.xls'] = expected['otsar_2026-10.xlsx'];
// 3) overlapping file, oldest first
writeBook('otsar_2026-10-15_2026-11-14.xlsx', [...meta('2026-10-15', '2026-11-14'), HEAD, ...overlap.map((r) => dataRow(r))]);
expected['otsar_2026-10-15_2026-11-14.xlsx'] = { ...summarize(rows.filter((r) => r.date >= '2026-10-15')), period: { from: '2026-10-15', to: '2026-11-14' }, mask: '6789', errors: 0, newRowsAfterOctober: rows.filter((r) => r.date > '2026-10-31').length };
// 4) header on row 9
const shifted = oct.slice(0, 12);
writeBook('otsar_shifted_header.xlsx', [...meta('2026-10-01', '2026-10-05', 4), [], [], ...[]].slice(0, 8).concat([HEAD], shifted.map((r) => dataRow(r))));
expected['otsar_shifted_header.xlsx'] = { ...summarize(rows.filter((r) => r.date <= '2026-10-31').slice(0, 12)), headerRow: 9, errors: 0 };
// 5) broken
const brokenAoa = [...meta('2026-10-01', '2026-10-31'), HEAD, ...oct.slice(0, 5).map((r) => dataRow(r))];
brokenAoa.push([null, 0, 'abc', 0, 10, 'תאריך שבור', '900001', 'כרטיס חיוב', 'abc']);
brokenAoa.push([null, 0, serial('2026-10-06'), 10, 20, 'גם זכות וגם חובה', '900002', 'כרטיס חיוב', serial('2026-10-06')]);
brokenAoa.push([null, 0, serial('2026-10-06'), 'xx', 0, 'סכום לא מספרי', '900003', 'כרטיס חיוב', serial('2026-10-06')]);
brokenAoa.push([null, 0, '31/13/2026', 0, 5, 'חודש 13', '900004', 'כרטיס חיוב', '31/13/2026']);
brokenAoa.push([null, null, null, 1000, 2000, 'סה"כ', null, null, null]);
writeBook('broken.xlsx', brokenAoa);
expected['broken.xlsx'] = { rows: 5, errors: [{ row: 12, code: 'date_invalid' }, { row: 13, code: 'amount_invalid' }, { row: 14, code: 'amount_invalid' }, { row: 15, code: 'date_invalid' }] };
// 6) HTML table saved as .xls (string dates)
const html = oct.slice(0, 10);
const td = (v) => `<td>${v ?? ''}</td>`;
writeFileSync(
  `${OUT}/html_table.xls`,
  `<html><head><meta charset="utf-8"></head><body><table dir="rtl">` +
    `<tr><td>מתאריך 01/10/2026 עד תאריך 31/10/2026</td></tr><tr></tr>` +
    `<tr>${HEAD.slice(1).map(td).join('')}</tr>` +
    html.map((r) => `<tr>${dataRow(r, ddmmyyyy).slice(1).map((v) => td(typeof v === 'number' ? v.toFixed(2) : v)).join('')}</tr>`).join('') +
    `</table></body></html>`,
);
expected['html_table.xls'] = { ...summarize(rows.filter((r) => r.date <= '2026-10-31').slice(0, 10)), errors: 0 };
// 7) generic CSV in windows-1255: other headers, one signed amount, dd.MM.yy
const gen = rows.filter((r) => r.date <= '2026-10-20');
const csvLines = ['דף חשבון - בנק לדוגמה', '', 'תאריך,פרטים,סכום,יתרה,אסמכתא', ...gen.map((r) => `${ddmmyy(r.date)},"${r.desc.trim()}","${(r.amount / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })}","${(r.balanceTrue / 100).toFixed(2)}",${r.ref}`)];
writeFileSync(`${OUT}/generic_bank.csv`, Buffer.from(cpexcel.utils.encode(1255, csvLines.join('\r\n') + '\r\n')));
expected['generic_bank.csv'] = { ...summarize(gen), headerRow: 2, errors: 0 };
writeFileSync(`${OUT}/expected.json`, JSON.stringify(expected, null, 2) + '\n');
console.log('fixtures written:', Object.keys(expected).join(', '));
