// Synthetic Isracard / American Express style statement PDF for tests (PLAN §14). All data is invented.
// Same structure as the real statement: a foreign table and a domestic table, columns right-aligned
// under their headers, a business name that wraps, a reference number under a foreign row, a refund,
// a table that continues on page 2, and a credit-terms section with dates and amounts to ignore.
// Run: node scripts/gen-card-pdf.mjs   → fixtures/isracard/synthetic/statement.pdf
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const OUT = 'fixtures/isracard/synthetic';
mkdirSync(OUT, { recursive: true });

const foreign = [
  ['01/10/26', 'א', 'PAYPAL *TOURSHOP', '310.00', '9911223344'],
  ['05/10/26', 'ק', 'HOTEL NORDLICHT', '1,250.40', '1234567890'],
  ['20/10/26', 'א', 'PAYPAL *TOURSHOP', '-310.00', '9911223344'],
];
const domestic = [
  ['02/10/26', 'מאפיית השקד', 'מזון', '42.50', '42.50'],
  ['03/10/26', 'סופר הגבעה פארק', 'מכולת/סופר', '186.30', '186.30', 'המרכזי'],
  ['07/10/26', 'קפה לימון', 'מסעדות/קפה', '38.00', '38.00'],
  ['09/10/26', 'דלק הצפון', 'דלק', '250.00', '250.00'],
  ['12/10/26', 'מרפאת השן', 'רפואה', '1,200.00', '400.00', '', 'תשלום 1 מתוך 3'],
  ['14/10/26', 'קפה לימון', 'מסעדות/קפה', '24.00', '24.00'],
];
const domestic2 = [
  ['21/10/26', 'ספרים ועוד', 'שונות', '89.90', '89.90'],
  ['28/10/26', 'מאפיית השקד', 'מזון', '31.00', '31.00'],
];
const sum = (rs, i) => rs.reduce((a, r) => a + Number(r[i].replace(/,/g, '')), 0).toFixed(2);
const fmt = (n) => Number(n).toLocaleString('en-US', { minimumFractionDigits: 2 });

const td = (s = '', cls = '') => `<td class="${cls}">${s}</td>`;
const domHead = `<tr class="h">${td('תאריך עסקה')}${td('כרטיס בעסקה')}${td('שם בית עסק')}${td('ענף')}${td('סכום עסקה')}${td('סכום החיוב בש"ח')}${td('פירוט נוסף')}</tr>`;
const domRow = (r) =>
  `<tr>${td(r[0])}${td('תש. נייד')}${td(r[1])}${td(r[2])}${td(r[3])}${td(r[4])}${td(r[6] ?? '')}</tr>` + (r[5] ? `<tr>${td()}${td()}${td(r[5])}${td()}${td()}${td()}${td()}</tr>` : '');
const page = (body) => `<section>${body}</section>`;
const html = `<!doctype html><html dir="rtl" lang="he"><head><meta charset="utf-8"><style>
  @page { size: A4; margin: 15mm; }
  body { font-family: 'DejaVu Sans', sans-serif; font-size: 9px; }
  section { page-break-after: always; }
  table { border-collapse: collapse; margin: 8px 0 14px; }
  td { padding: 1px 12px 1px 0; text-align: right; white-space: nowrap; }
  .h td { font-weight: bold; }
  h2 { font-size: 11px; margin: 10px 0 2px; }
</style></head><body>
${page(`<p>לכבוד ישראל ישראלי, רחוב הדוגמה 1 עיר הדוגמה</p>
<p>פרוט פעולותיך לתאריך: 02/11/26 · כרטיס שמסתיים בספרות: 0000</p>
<h2>רכישות בחו"ל</h2>
<table>
<tr class="h">${td('תאריך')}${td('סוג')}${td('שם בית העסק')}${td('סכום מקורי')}${td('סכום ב-$')}${td('תאריך המרה')}${td('שער המרה')}${td('סכום עמלה')}${td('סכום החיוב')}</tr>
${foreign.map((r) => `<tr>${td(r[0])}${td(r[1])}${td(r[2])}${td('₪ ' + r[3])}${td()}${td()}${td()}${td()}${td(r[3])}</tr><tr>${td()}${td()}${td(r[4])}${td()}${td()}${td()}${td()}${td()}${td()}</tr>`).join('')}
<tr>${td('סה"כ חיוב לתאריך 02/11/26')}${td()}${td()}${td()}${td()}${td()}${td()}${td()}${td(fmt(sum(foreign, 3)))}</tr>
</table>
<h2>עסקות שחויבו / זוכו - בארץ</h2>
<table>${domHead}${domestic.map(domRow).join('')}</table>`)}
${page(`<h2>עסקות שחויבו / זוכו - בארץ - המשך מעמוד קודם</h2>
<table>${domHead}${domestic2.map(domRow).join('')}
<tr>${td('סה"כ חיוב לתאריך 02/11/26')}${td()}${td()}${td()}${td()}${td(fmt((+sum(domestic, 4) + +sum(domestic2, 4)).toFixed(2)))}${td()}</tr></table>
<h2>מסגרת הכרטיס ותנאי האשראי</h2>
<table><tr class="h">${td('סוג הסדר אשראי')}${td('תאריך')}${td('שם בית')}${td('סכום')}</tr><tr>${td('קרדיט')}${td('03/10/2026')}${td('יתרה')}${td('₪ 0.00')}</tr></table>`)}
</body></html>`;

const browser = await chromium.launch();
const p = await browser.newPage();
await p.setContent(html);
await p.pdf({ path: `${OUT}/statement.pdf`, format: 'A4', printBackground: false });
await browser.close();
console.log(`${OUT}/statement.pdf: foreign ${sum(foreign, 3)}, domestic ${(+sum(domestic, 4) + +sum(domestic2, 4)).toFixed(2)}`);
