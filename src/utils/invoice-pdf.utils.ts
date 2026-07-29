/**
 * Invoice PDF Generator
 *
 * Produces a well-formatted A4 invoice PDF using pdfkit. Each invoice includes:
 *  - Company branding (header + accent colour)
 *  - Invoice metadata (number, issue date, due date)
 *  - Bill-to section (recipient name + email)
 *  - Itemised line-items table (description, qty, unit price, tax rate, line total)
 *  - Subtotal / tax / grand-total summary box
 *  - QR code linking to the platform invoice-verification endpoint
 *  - Branded footer with generation timestamp
 *
 * Returns a Buffer so the caller can upload it to S3 directly without touching
 * the filesystem.
 */

import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';
import { LineItem } from '../services/invoice.service';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface InvoicePdfData {
  invoiceId: string;
  invoiceNumber: string;
  issuedAt: Date;
  dueDate: Date;
  recipientName: string;
  recipientEmail: string;
  lineItems: LineItem[];
  subtotal: string;
  tax: string;
  total: string;
  currency: string;
  /** e.g. https://app.mentorminds.com */
  appBaseUrl: string;
  /** Platform branding colour (hex). Defaults to #0066cc. */
  brandColor?: string;
  /** Platform display name. Defaults to "MentorMinds". */
  platformName?: string;
}

// ---------------------------------------------------------------------------
// Layout constants
// ---------------------------------------------------------------------------

const PAGE_MARGIN = 50;
const PAGE_WIDTH = 595.28; // A4 points
const CONTENT_WIDTH = PAGE_WIDTH - PAGE_MARGIN * 2;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Generates an invoice PDF and returns it as a resolved Buffer.
 */
export async function generateInvoicePdf(data: InvoicePdfData): Promise<Buffer> {
  const qrCodeDataUrl = await buildQrCodeDataUrl(data.appBaseUrl, data.invoiceId);

  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];

    const doc = new PDFDocument({ margin: PAGE_MARGIN, size: 'A4' });

    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const brand = data.brandColor ?? '#0066cc';
    const platform = data.platformName ?? 'MentorMinds';

    renderDocument(doc, data, brand, platform, qrCodeDataUrl);

    doc.end();
  });
}

// ---------------------------------------------------------------------------
// Rendering helpers
// ---------------------------------------------------------------------------

function renderDocument(
  doc: InstanceType<typeof PDFDocument>,
  data: InvoicePdfData,
  brand: string,
  platform: string,
  qrDataUrl: string,
): void {
  renderHeader(doc, platform, brand);
  renderInvoiceMeta(doc, data);
  renderBillTo(doc, data);
  doc.moveDown(1.5);
  renderLineItemsTable(doc, data);
  doc.moveDown(1);
  renderTotalsBox(doc, data);
  doc.moveDown(1.5);
  renderQrCode(doc, qrDataUrl, data.invoiceId, data.appBaseUrl);
  renderFooter(doc, platform);
}

// ── Header ────────────────────────────────────────────────────────────────────

function renderHeader(
  doc: InstanceType<typeof PDFDocument>,
  platform: string,
  brand: string,
): void {
  // Platform name (top-left)
  doc
    .fontSize(22)
    .font('Helvetica-Bold')
    .fillColor(brand)
    .text(platform, PAGE_MARGIN, PAGE_MARGIN, { continued: false });

  // "INVOICE" title (top-right)
  doc
    .fontSize(28)
    .font('Helvetica-Bold')
    .fillColor('#333333')
    .text('INVOICE', PAGE_MARGIN, PAGE_MARGIN, { align: 'right' });

  // Horizontal rule
  doc
    .strokeColor(brand)
    .lineWidth(2)
    .moveTo(PAGE_MARGIN, doc.y + 8)
    .lineTo(PAGE_WIDTH - PAGE_MARGIN, doc.y + 8)
    .stroke();

  doc.moveDown(2);
}

// ── Invoice metadata ──────────────────────────────────────────────────────────

function renderInvoiceMeta(
  doc: InstanceType<typeof PDFDocument>,
  data: InvoicePdfData,
): void {
  const topY = doc.y;

  // Left column: invoice number + dates
  doc
    .fontSize(9)
    .font('Helvetica')
    .fillColor('#666666')
    .text('Invoice Number', PAGE_MARGIN, topY)
    .font('Helvetica-Bold')
    .fillColor('#222222')
    .text(data.invoiceNumber, PAGE_MARGIN, doc.y);

  doc.moveDown(0.6);
  doc
    .font('Helvetica')
    .fillColor('#666666')
    .text('Issue Date')
    .font('Helvetica-Bold')
    .fillColor('#222222')
    .text(formatDate(data.issuedAt));

  doc.moveDown(0.6);
  doc
    .font('Helvetica')
    .fillColor('#666666')
    .text('Due Date')
    .font('Helvetica-Bold')
    .fillColor('#222222')
    .text(formatDate(data.dueDate));

  // Right column: total-due callout box
  const boxX = PAGE_WIDTH - PAGE_MARGIN - 180;
  const boxY = topY;
  const boxW = 180;
  const boxH = 80;

  doc
    .roundedRect(boxX, boxY, boxW, boxH, 4)
    .fillAndStroke('#f0f6ff', '#cce0ff');

  doc
    .fontSize(9)
    .font('Helvetica')
    .fillColor('#555555')
    .text('Amount Due', boxX, boxY + 12, { width: boxW, align: 'center' });

  doc
    .fontSize(20)
    .font('Helvetica-Bold')
    .fillColor('#0055bb')
    .text(
      `${formatAmount(data.total)} ${data.currency}`,
      boxX,
      boxY + 32,
      { width: boxW, align: 'center' },
    );

  doc.y = topY + boxH + 20;
}

// ── Bill-to ───────────────────────────────────────────────────────────────────

function renderBillTo(
  doc: InstanceType<typeof PDFDocument>,
  data: InvoicePdfData,
): void {
  doc
    .fontSize(9)
    .font('Helvetica-Bold')
    .fillColor('#888888')
    .text('BILL TO');

  doc
    .moveDown(0.3)
    .fontSize(11)
    .font('Helvetica-Bold')
    .fillColor('#222222')
    .text(data.recipientName);

  doc
    .fontSize(10)
    .font('Helvetica')
    .fillColor('#444444')
    .text(data.recipientEmail);
}

// ── Line-items table ──────────────────────────────────────────────────────────

const COL = {
  description: { x: PAGE_MARGIN, w: 220 },
  qty:         { x: PAGE_MARGIN + 225, w: 50 },
  unitPrice:   { x: PAGE_MARGIN + 280, w: 80 },
  taxRate:     { x: PAGE_MARGIN + 365, w: 50 },
  total:       { x: PAGE_MARGIN + 420, w: 75 },
} as const;

const ROW_H = 22;

function renderLineItemsTable(
  doc: InstanceType<typeof PDFDocument>,
  data: InvoicePdfData,
): void {
  // Header row
  const headerY = doc.y;
  doc.rect(PAGE_MARGIN, headerY, CONTENT_WIDTH, ROW_H).fill('#f0f0f0');

  doc.fontSize(8).font('Helvetica-Bold').fillColor('#333333');
  renderTableRow(doc, headerY + 6, 'Description', 'Qty', 'Unit Price', 'Tax %', 'Total');

  let rowY = headerY + ROW_H;

  data.lineItems.forEach((item, idx) => {
    // Overflow guard — add a new page if we're near the bottom
    if (rowY > 700) {
      doc.addPage();
      rowY = PAGE_MARGIN;
    }

    if (idx % 2 === 1) {
      doc.rect(PAGE_MARGIN, rowY, CONTENT_WIDTH, ROW_H).fill('#fafafa');
    }

    doc.fontSize(8).font('Helvetica').fillColor('#333333');
    renderTableRow(
      doc,
      rowY + 6,
      item.description,
      String(item.quantity),
      formatAmount(item.unitPrice),
      `${(item.taxRate * 100).toFixed(1)}%`,
      formatAmount(item.total),
    );

    // Bottom border for each row
    doc
      .strokeColor('#e8e8e8')
      .lineWidth(0.5)
      .moveTo(PAGE_MARGIN, rowY + ROW_H)
      .lineTo(PAGE_WIDTH - PAGE_MARGIN, rowY + ROW_H)
      .stroke();

    rowY += ROW_H;
  });

  doc.y = rowY + 4;
}

function renderTableRow(
  doc: InstanceType<typeof PDFDocument>,
  y: number,
  description: string,
  qty: string,
  unitPrice: string,
  taxRate: string,
  total: string,
): void {
  // Truncate long descriptions
  const desc = description.length > 40 ? description.slice(0, 37) + '...' : description;
  doc.text(desc,      COL.description.x, y, { width: COL.description.w, lineBreak: false });
  doc.text(qty,       COL.qty.x,         y, { width: COL.qty.w,         lineBreak: false, align: 'right' });
  doc.text(unitPrice, COL.unitPrice.x,   y, { width: COL.unitPrice.w,   lineBreak: false, align: 'right' });
  doc.text(taxRate,   COL.taxRate.x,     y, { width: COL.taxRate.w,     lineBreak: false, align: 'right' });
  doc.text(total,     COL.total.x,       y, { width: COL.total.w,       lineBreak: false, align: 'right' });
}

// ── Totals summary box ────────────────────────────────────────────────────────

function renderTotalsBox(
  doc: InstanceType<typeof PDFDocument>,
  data: InvoicePdfData,
): void {
  const boxW = 220;
  const boxX = PAGE_WIDTH - PAGE_MARGIN - boxW;
  const startY = doc.y;

  const rows: Array<{ label: string; value: string; bold?: boolean; colour?: string }> = [
    { label: 'Subtotal',   value: `${formatAmount(data.subtotal)} ${data.currency}` },
    { label: 'Tax',        value: `${formatAmount(data.tax)} ${data.currency}` },
    { label: 'Total Due',  value: `${formatAmount(data.total)} ${data.currency}`, bold: true, colour: '#0055bb' },
  ];

  const rowH = 22;
  const boxH = rows.length * rowH + 16;

  doc.roundedRect(boxX, startY, boxW, boxH, 4).fillAndStroke('#f8f8f8', '#dddddd');

  rows.forEach((row, i) => {
    const y = startY + 8 + i * rowH;
    const isLast = i === rows.length - 1;

    if (isLast) {
      doc.rect(boxX, y, boxW, rowH).fillAndStroke('#e8f0ff', '#c0d8ff');
    }

    doc
      .fontSize(9)
      .font(row.bold ? 'Helvetica-Bold' : 'Helvetica')
      .fillColor(row.colour ?? '#444444')
      .text(row.label, boxX + 10, y + 6);

    doc
      .fontSize(9)
      .font(row.bold ? 'Helvetica-Bold' : 'Helvetica')
      .fillColor(row.colour ?? '#333333')
      .text(row.value, boxX, y + 6, { width: boxW - 10, align: 'right' });
  });

  doc.y = startY + boxH + 8;
}

// ── QR code ───────────────────────────────────────────────────────────────────

function renderQrCode(
  doc: InstanceType<typeof PDFDocument>,
  qrDataUrl: string,
  invoiceId: string,
  baseUrl: string,
): void {
  if (!qrDataUrl) return;

  // Strip data URL prefix to get raw base64
  const base64 = qrDataUrl.replace(/^data:image\/png;base64,/, '');
  const imgBuffer = Buffer.from(base64, 'base64');

  const qrSize = 80;
  const qrX = PAGE_MARGIN;
  const qrY = doc.y;

  doc.image(imgBuffer, qrX, qrY, { width: qrSize, height: qrSize });

  doc
    .fontSize(8)
    .font('Helvetica-Bold')
    .fillColor('#555555')
    .text('Verify Invoice', qrX + qrSize + 10, qrY + 10);

  doc
    .fontSize(7)
    .font('Helvetica')
    .fillColor('#777777')
    .text(
      `Scan to verify: ${baseUrl}/invoices/${invoiceId}/verify`,
      qrX + qrSize + 10,
      qrY + 25,
      { width: 300 },
    );

  doc.y = qrY + qrSize + 10;
}

// ── Footer ────────────────────────────────────────────────────────────────────

function renderFooter(
  doc: InstanceType<typeof PDFDocument>,
  platform: string,
): void {
  const footerY = doc.page.height - PAGE_MARGIN - 30;

  doc
    .strokeColor('#dddddd')
    .lineWidth(0.5)
    .moveTo(PAGE_MARGIN, footerY)
    .lineTo(PAGE_WIDTH - PAGE_MARGIN, footerY)
    .stroke();

  doc
    .fontSize(8)
    .font('Helvetica')
    .fillColor('#aaaaaa')
    .text(
      `Generated by ${platform} on ${new Date().toUTCString()}`,
      PAGE_MARGIN,
      footerY + 8,
      { align: 'center', width: CONTENT_WIDTH },
    );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function buildQrCodeDataUrl(baseUrl: string, invoiceId: string): Promise<string> {
  try {
    const url = `${baseUrl}/invoices/${invoiceId}/verify`;
    return await QRCode.toDataURL(url, {
      errorCorrectionLevel: 'M',
      margin: 1,
      width: 160,
    });
  } catch {
    return '';
  }
}

function formatDate(d: Date): string {
  return new Date(d).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

function formatAmount(value: string | number): string {
  const n = typeof value === 'string' ? parseFloat(value) : value;
  if (isNaN(n)) return String(value);
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 7 });
}
