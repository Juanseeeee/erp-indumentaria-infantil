import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import type { ReportColumn, ReportResult } from '@erp/contracts';

/** Encabezado común de los archivos: empresa, usuario y momento de generación. */
export interface ExportMeta {
  company: string;
  user: string;
}

const TZ = process.env.BUSINESS_TZ ?? 'America/Argentina/Buenos_Aires';
const NUMERIC: ReportColumn['type'][] = ['money', 'qty', 'int', 'pct'];
const fmt2 = new Intl.NumberFormat('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtQ = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 4 });
const fmt1 = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 1 });
const stamp = (iso: string) =>
  new Intl.DateTimeFormat('es-AR', { timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));

/** Texto de una celda tal como se ve en pantalla (formato argentino). */
export function cellText(type: ReportColumn['type'], v: string | number | null | undefined): string {
  if (v == null || v === '') return '';
  if (type === 'money') return `$ ${fmt2.format(Number(v))}`;
  if (type === 'qty' || type === 'int') return fmtQ.format(Number(v));
  if (type === 'pct') return `${fmt1.format(Number(v))} %`;
  if (type === 'date') return `${String(v).slice(8, 10)}/${String(v).slice(5, 7)}/${String(v).slice(0, 4)}`;
  return String(v);
}

export const exportFileName = (r: ReportResult, ext: string) => `${r.code}-${r.generatedAt.slice(0, 10)}.${ext}`;

/** Excel: valores numéricos y fechas reales (se pueden sumar y filtrar), encabezado fijo y autofiltro. */
export async function toXlsx(r: ReportResult, meta: ExportMeta): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = meta.user;
  wb.created = new Date(r.generatedAt);
  const ws = wb.addWorksheet(r.title.replace(/[\\/*?:[\]]/g, '').slice(0, 31));
  ws.addRow([`${meta.company} · ${r.title}`]).font = { bold: true, size: 14 };
  ws.addRow([r.subtitle]);
  ws.addRow([`Generado el ${stamp(r.generatedAt)} por ${meta.user}`]).font = { italic: true, color: { argb: 'FF666666' } };
  ws.addRow([]);
  const header = ws.addRow(r.columns.map((c) => c.label));
  header.font = { bold: true };
  header.eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFEFEF' } };
    cell.border = { bottom: { style: 'thin' } };
  });
  const headerRow = header.number;

  const value = (c: ReportColumn, v: string | number | null | undefined) => {
    if (v == null || v === '') return null;
    if (NUMERIC.includes(c.type)) return Number(v);
    if (c.type === 'date' && /^\d{4}-\d{2}-\d{2}$/.test(String(v))) return new Date(`${v}T00:00:00.000Z`);
    return String(v);
  };
  for (const row of r.rows) ws.addRow(r.columns.map((c) => value(c, row[c.key])));
  if (r.totals) {
    const t = ws.addRow(r.columns.map((c) => value(c, r.totals![c.key])));
    t.font = { bold: true };
    t.eachCell((cell) => (cell.border = { top: { style: 'thin' } }));
  }
  r.columns.forEach((c, i) => {
    const column = ws.getColumn(i + 1);
    column.numFmt = c.type === 'money' ? '#,##0.00' : c.type === 'pct' ? '0.0"%"' : c.type === 'date' ? 'dd/mm/yyyy' : c.type === 'qty' ? '#,##0.####' : c.type === 'int' ? '0' : '@';
    if (NUMERIC.includes(c.type)) column.alignment = { horizontal: 'right' };
    const longest = Math.max(c.label.length, ...r.rows.map((row) => cellText(c.type, row[c.key]).length));
    column.width = Math.min(48, Math.max(10, longest + 2));
  });
  // Las tres primeras filas son títulos: no se les aplica formato numérico de columna.
  for (let i = 1; i < headerRow; i++) ws.getRow(i).eachCell((cell) => (cell.numFmt = 'General'));
  ws.views = [{ state: 'frozen', ySplit: headerRow }];
  ws.autoFilter = { from: { row: headerRow, column: 1 }, to: { row: headerRow, column: r.columns.length } };
  if (r.notes.length) {
    ws.addRow([]);
    for (const n of r.notes) ws.addRow([n]).font = { italic: true, color: { argb: 'FF666666' } };
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/** PDF A4 apaisado para imprimir o enviar: encabezado repetido en cada hoja y número de página. */
export function toPdf(r: ReportResult, meta: ExportMeta): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 36, bufferPages: true, info: { Title: r.title, Author: meta.user, Creator: meta.company } });
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));

  const left = doc.page.margins.left;
  const width = doc.page.width - left - doc.page.margins.right;
  const bottom = doc.page.height - doc.page.margins.bottom - 18;
  const FONT = 8;
  const ROW = 14;

  // Anchos proporcionales al contenido (con mínimo y máximo), escalados al ancho de la hoja.
  const all = [...r.rows, ...(r.totals ? [r.totals] : [])];
  const natural = r.columns.map((c) => {
    doc.font('Helvetica-Bold').fontSize(FONT);
    let w = doc.widthOfString(c.label);
    doc.font('Helvetica');
    for (const row of all.slice(0, 500)) w = Math.max(w, doc.widthOfString(cellText(c.type, row[c.key])));
    return Math.min(220, Math.max(36, w + 8));
  });
  const scale = width / natural.reduce((a, b) => a + b, 0);
  const widths = natural.map((w) => w * scale);

  doc.font('Helvetica-Bold').fontSize(13).text(r.title, left, doc.y);
  doc.font('Helvetica').fontSize(9).fillColor('#444444').text(`${meta.company} · ${r.subtitle}`);
  doc.text(`Generado el ${stamp(r.generatedAt)} por ${meta.user}`).fillColor('#000000');
  doc.moveDown(0.6);

  const drawRow = (cells: string[], opts: { bold?: boolean; header?: boolean; line?: 'top' | 'bottom' } = {}) => {
    if (doc.y + ROW > bottom) {
      doc.addPage();
      if (!opts.header) drawHeader();
    }
    const y = doc.y;
    if (opts.header) doc.rect(left, y - 2, width, ROW).fill('#efefef').fillColor('#000000');
    doc.font(opts.bold || opts.header ? 'Helvetica-Bold' : 'Helvetica').fontSize(FONT);
    let x = left;
    r.columns.forEach((c, i) => {
      const numeric = NUMERIC.includes(c.type);
      doc.text(cells[i] ?? '', x + 3, y + 1, { width: widths[i]! - 6, align: numeric ? 'right' : 'left', lineBreak: false, ellipsis: true });
      x += widths[i]!;
    });
    if (opts.line) {
      const ly = opts.line === 'top' ? y - 2 : y + ROW - 2;
      doc.moveTo(left, ly).lineTo(left + width, ly).lineWidth(0.5).strokeColor('#999999').stroke();
    }
    doc.x = left;
    doc.y = y + ROW;
  };
  const drawHeader = () => drawRow(r.columns.map((c) => c.label), { header: true });

  drawHeader();
  if (!r.rows.length) drawRow([`Sin datos para los parámetros elegidos.`]);
  for (const row of r.rows) drawRow(r.columns.map((c) => cellText(c.type, row[c.key])));
  if (r.totals) drawRow(r.columns.map((c) => cellText(c.type, r.totals![c.key])), { bold: true, line: 'top' });

  if (r.notes.length) {
    doc.moveDown(0.8);
    doc.font('Helvetica-Oblique').fontSize(8).fillColor('#444444');
    for (const n of r.notes) {
      if (doc.y + 2 * ROW > bottom) doc.addPage();
      doc.text(n, left, doc.y, { width });
    }
    doc.fillColor('#000000');
  }

  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    // Sin margen inferior mientras se escribe el pie: si no, pdfkit agrega una hoja en blanco.
    const margin = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc.font('Helvetica').fontSize(7).fillColor('#666666');
    doc.text(`${r.title} · Página ${i + 1} de ${range.count}`, left, doc.page.height - margin - 8, { width, align: 'right', lineBreak: false });
    doc.page.margins.bottom = margin;
  }
  doc.end();
  return done;
}
