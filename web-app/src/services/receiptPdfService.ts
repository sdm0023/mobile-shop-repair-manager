import { jsPDF } from 'jspdf';
import {
  CHECKLIST_ITEMS,
  computeJobFinancials,
  JobStage,
  parseChecklist,
  RepairJob,
  ShopProfile,
  STAGE_LABELS,
} from '../types/repairShop';

export type ReceiptLayoutMode = 'a4' | 'thermal';

export interface GeneratedReceiptPdf {
  blob: Blob;
  file: File;
  fileName: string;
}

export interface WhatsAppPdfShareResult {
  method: 'native-share' | 'download-and-open' | 'cancelled';
  fileName: string;
}

function sanitizeFileSegment(raw: string): string {
  return raw
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
}

export function buildReceiptFileName(
  job: RepairJob,
  layoutMode: ReceiptLayoutMode
): string {
  const jobSegment = sanitizeFileSegment(job.jobNumber || job.recordUuid || 'JOB');
  const suffix = layoutMode === 'thermal' ? '_80mm' : '_Invoice';
  return `Receipt_${jobSegment}${suffix}.pdf`;
}

export function canSharePdfFiles(): boolean {
  if (typeof navigator === 'undefined') return false;
  if (typeof navigator.share !== 'function' || typeof navigator.canShare !== 'function') {
    return false;
  }
  try {
    const probeFile = new File(['%PDF-1.4'], 'receipt.pdf', {
      type: 'application/pdf',
    });
    return navigator.canShare({ files: [probeFile] });
  } catch {
    return false;
  }
}

export function triggerPdfDownload(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export function openExternalWhatsAppLink(whatsappUrl: string): void {
  const anchor = document.createElement('a');
  anchor.href = whatsappUrl;
  anchor.target = '_blank';
  anchor.rel = 'noopener noreferrer';
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

function wrapTextLines(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number
): string[] {
  const paragraphs = text.split(/\r?\n/);
  const result: string[] = [];

  for (const paragraph of paragraphs) {
    const trimmed = paragraph.trim();
    if (!trimmed) {
      result.push('');
      continue;
    }

    const words = trimmed.split(/\s+/);
    let currentLine = '';

    for (const word of words) {
      const candidate = currentLine ? `${currentLine} ${word}` : word;
      if (ctx.measureText(candidate).width <= maxWidth) {
        currentLine = candidate;
      } else {
        if (currentLine) {
          result.push(currentLine);
          currentLine = '';
        }
        // Handle single long token wider than maxWidth
        if (ctx.measureText(word).width > maxWidth) {
          let chunk = '';
          for (const ch of word) {
            if (ctx.measureText(chunk + ch).width <= maxWidth) {
              chunk += ch;
            } else {
              if (chunk) result.push(chunk);
              chunk = ch;
            }
          }
          currentLine = chunk;
        } else {
          currentLine = word;
        }
      }
    }

    if (currentLine) {
      result.push(currentLine);
    }
  }

  return result.length > 0 ? result : [''];
}

function truncateText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number
): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  const ellipsis = '…';
  let truncated = text;
  while (truncated.length > 0 && ctx.measureText(truncated + ellipsis).width > maxWidth) {
    truncated = truncated.slice(0, -1);
  }
  return truncated ? truncated + ellipsis : ellipsis;
}

interface ReceiptRenderContext {
  job: RepairJob;
  shopProfile: ShopProfile | null;
  layoutMode: ReceiptLayoutMode;
}

/**
 * Renders the job receipt onto a high-DPI HTML5 canvas matching ReceiptPrintModal
 * so Unicode characters (INR symbol, Hindi, Gujarati, English) render crisply
 * without external stylesheet CORS or CSS color-function errors.
 */
function renderReceiptToCanvas({
  job,
  shopProfile,
  layoutMode,
}: ReceiptRenderContext): HTMLCanvasElement {
  const isThermal = layoutMode === 'thermal';
  const dpr = 2.5;
  const logicalWidth = isThermal ? 320 : 760;
  const padX = isThermal ? 16 : 36;
  const padY = isThermal ? 18 : 34;
  const contentWidth = logicalWidth - padX * 2;

  const fontSans = '"DM Sans", "Plus Jakarta Sans", system-ui, -apple-system, sans-serif';
  const fontMono = '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace';
  const baseFont = isThermal ? fontMono : fontSans;

  const currency = shopProfile?.currencySymbol || '₹';
  const fin = computeJobFinancials(job);
  const checklist = parseChecklist(job.checklistJson);
  const shopName = shopProfile?.shopName || 'Mobile Repair Shop';
  const tagline = shopProfile?.tagline?.trim() || '';
  const shopPhone = shopProfile?.contactPhone?.trim() || '';
  const shopAddress = shopProfile?.address?.trim() || '';
  const warrantyDays = shopProfile?.warrantyDays ?? 90;
  const terms = shopProfile?.termsAndConditions?.trim() || '';
  const createdDateStr = new Date(job.createdAt).toLocaleString();
  const stageLabel = STAGE_LABELS[job.stage] || job.stage;
  const deviceLabel =
    [job.deviceBrand, job.deviceModel, job.deviceColor ? `(${job.deviceColor})` : '']
      .filter(Boolean)
      .join(' ') || 'Device unspecified';

  // Two-pass drawing: pass 0 measures total height, pass 1 draws onto sized canvas
  const measureCanvas = document.createElement('canvas');
  measureCanvas.width = 10;
  measureCanvas.height = 10;
  const measureCtx = measureCanvas.getContext('2d');
  if (!measureCtx) {
    throw new Error('Unable to initialize canvas rendering context for PDF generation.');
  }

  const drawPass = (ctx: CanvasRenderingContext2D, shouldPaint: boolean): number => {
    let y = padY;

    const setFont = (weight: number, sizePx: number, family: string = baseFont) => {
      ctx.font = `${weight} ${sizePx}px ${family}`;
    };

    const drawDivider = (dashed = false, spacingBefore = 10, spacingAfter = 12) => {
      y += spacingBefore;
      if (shouldPaint) {
        ctx.save();
        ctx.strokeStyle = dashed ? '#A3A3A3' : '#D4D4D4';
        ctx.lineWidth = 1;
        if (dashed) ctx.setLineDash([4, 3]);
        ctx.beginPath();
        ctx.moveTo(padX, y);
        ctx.lineTo(logicalWidth - padX, y);
        ctx.stroke();
        ctx.restore();
      }
      y += spacingAfter;
    };

    const drawSectionLabel = (label: string) => {
      setFont(700, isThermal ? 10 : 11);
      if (shouldPaint) {
        ctx.fillStyle = '#525252';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.fillText(label.toUpperCase(), padX, y);
      }
      y += isThermal ? 14 : 17;
    };

    const drawWrapped = (
      text: string,
      x: number,
      maxWidth: number,
      lineHeight: number,
      color: string,
      align: CanvasTextAlign = 'left'
    ): number => {
      const lines = wrapTextLines(ctx, text, maxWidth);
      let cursorY = y;
      if (shouldPaint) {
        ctx.fillStyle = color;
        ctx.textAlign = align;
        ctx.textBaseline = 'top';
      }
      for (const line of lines) {
        if (shouldPaint && line) {
          ctx.fillText(line, x, cursorY);
        }
        cursorY += lineHeight;
      }
      return cursorY;
    };

    // 1. SHOP HEADER
    if (isThermal) {
      const centerX = logicalWidth / 2;
      setFont(700, 15, baseFont);
      y = drawWrapped(shopName.toUpperCase(), centerX, contentWidth, 19, '#000000', 'center');

      if (tagline) {
        setFont(400, 10);
        y = drawWrapped(tagline, centerX, contentWidth, 14, '#404040', 'center');
      }
      if (shopAddress) {
        y += 2;
        setFont(400, 10);
        y = drawWrapped(shopAddress, centerX, contentWidth, 14, '#404040', 'center');
      }
      if (shopPhone) {
        y += 2;
        setFont(600, 10);
        y = drawWrapped(`Tel: ${shopPhone}`, centerX, contentWidth, 14, '#262626', 'center');
      }

      drawDivider(true, 8, 8);

      setFont(700, 12);
      y = drawWrapped(`JOB: ${job.jobNumber}`, centerX, contentWidth, 16, '#000000', 'center');
      setFont(400, 10);
      y = drawWrapped(`Date: ${createdDateStr}`, centerX, contentWidth, 14, '#404040', 'center');
      setFont(600, 10);
      y = drawWrapped(`Stage: ${stageLabel}`, centerX, contentWidth, 14, '#000000', 'center');
    } else {
      const leftMaxW = contentWidth * 0.56;
      const rightMaxW = contentWidth * 0.4;
      const startY = y;

      // Left column: Shop details
      let leftY = startY;
      setFont(700, 22, fontSans);
      const shopLines = wrapTextLines(ctx, shopName, leftMaxW);
      if (shouldPaint) {
        ctx.fillStyle = '#000000';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
      }
      for (const line of shopLines) {
        if (shouldPaint) ctx.fillText(line, padX, leftY);
        leftY += 27;
      }

      if (tagline) {
        setFont(400, 12);
        const tagLines = wrapTextLines(ctx, tagline, leftMaxW);
        if (shouldPaint) ctx.fillStyle = '#404040';
        for (const line of tagLines) {
          if (shouldPaint) ctx.fillText(line, padX, leftY);
          leftY += 16;
        }
      }
      if (shopAddress) {
        leftY += 3;
        setFont(400, 12);
        const addrLines = wrapTextLines(ctx, shopAddress, leftMaxW);
        if (shouldPaint) ctx.fillStyle = '#404040';
        for (const line of addrLines) {
          if (shouldPaint) ctx.fillText(line, padX, leftY);
          leftY += 16;
        }
      }
      if (shopPhone) {
        leftY += 2;
        setFont(600, 12);
        if (shouldPaint) {
          ctx.fillStyle = '#262626';
          ctx.fillText(`Tel: ${shopPhone}`, padX, leftY);
        }
        leftY += 17;
      }

      // Right column: Invoice metadata
      let rightY = startY;
      const rightX = logicalWidth - padX;
      setFont(700, 13, fontSans);
      if (shouldPaint) {
        ctx.fillStyle = '#000000';
        ctx.textAlign = 'right';
        ctx.textBaseline = 'top';
        ctx.fillText('REPAIR JOB CARD / INVOICE', rightX, rightY);
      }
      rightY += 19;

      setFont(700, 16, fontMono);
      if (shouldPaint) {
        ctx.fillStyle = '#000000';
        ctx.fillText(job.jobNumber, rightX, rightY);
      }
      rightY += 22;

      setFont(400, 11.5, fontSans);
      const dateLines = wrapTextLines(ctx, `Date: ${createdDateStr}`, rightMaxW);
      if (shouldPaint) ctx.fillStyle = '#404040';
      for (const line of dateLines) {
        if (shouldPaint) ctx.fillText(line, rightX, rightY);
        rightY += 16;
      }

      setFont(600, 12, fontSans);
      if (shouldPaint) {
        ctx.fillStyle = '#000000';
        ctx.fillText(`Stage: ${stageLabel}`, rightX, rightY);
      }
      rightY += 17;

      y = Math.max(leftY, rightY);
    }

    drawDivider(false, 8, 12);

    // 2. CUSTOMER & DEVICE SECTION
    if (isThermal) {
      drawSectionLabel('Customer');
      setFont(600, 11);
      y = drawWrapped(job.customerName || 'Walk-in Customer', padX, contentWidth, 15, '#000000');
      setFont(400, 10.5);
      y = drawWrapped(job.customerPhone || '—', padX, contentWidth, 14, '#262626');
      y += 6;

      drawSectionLabel('Device');
      setFont(600, 11);
      y = drawWrapped(deviceLabel, padX, contentWidth, 15, '#000000');
      setFont(400, 10.5);
      y = drawWrapped(`IMEI/SN: ${job.imeiOrSerial || '—'}`, padX, contentWidth, 14, '#262626');
    } else {
      const colGap = 24;
      const colW = (contentWidth - colGap) / 2;
      const startY = y;

      // Left: Customer
      let leftY = startY;
      setFont(700, 11);
      if (shouldPaint) {
        ctx.fillStyle = '#525252';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.fillText('CUSTOMER', padX, leftY);
      }
      leftY += 17;

      setFont(600, 14);
      const custLines = wrapTextLines(ctx, job.customerName || 'Walk-in Customer', colW);
      if (shouldPaint) ctx.fillStyle = '#000000';
      for (const line of custLines) {
        if (shouldPaint) ctx.fillText(line, padX, leftY);
        leftY += 19;
      }

      setFont(400, 13);
      if (shouldPaint) {
        ctx.fillStyle = '#262626';
        ctx.fillText(job.customerPhone || '—', padX, leftY);
      }
      leftY += 18;

      // Right: Device
      let rightY = startY;
      const rightColX = padX + colW + colGap;
      setFont(700, 11);
      if (shouldPaint) {
        ctx.fillStyle = '#525252';
        ctx.textAlign = 'left';
        ctx.fillText('DEVICE', rightColX, rightY);
      }
      rightY += 17;

      setFont(600, 14);
      const devLines = wrapTextLines(ctx, deviceLabel, colW);
      if (shouldPaint) ctx.fillStyle = '#000000';
      for (const line of devLines) {
        if (shouldPaint) ctx.fillText(line, rightColX, rightY);
        rightY += 19;
      }

      setFont(400, 13);
      const imeiLines = wrapTextLines(ctx, `IMEI/SN: ${job.imeiOrSerial || '—'}`, colW);
      if (shouldPaint) ctx.fillStyle = '#262626';
      for (const line of imeiLines) {
        if (shouldPaint) ctx.fillText(line, rightColX, rightY);
        rightY += 18;
      }

      y = Math.max(leftY, rightY);
    }

    drawDivider(false, 8, 12);

    // 3. REPORTED FAULT
    drawSectionLabel('Reported Fault');
    setFont(400, isThermal ? 11 : 13.5);
    y = drawWrapped(
      job.issueDescription || '—',
      padX,
      contentWidth,
      isThermal ? 15 : 19,
      '#000000'
    );
    if (job.issueTagsCsv) {
      y += 4;
      setFont(400, isThermal ? 10 : 12);
      y = drawWrapped(
        `Tags: ${job.issueTagsCsv}`,
        padX,
        contentWidth,
        isThermal ? 14 : 17,
        '#404040'
      );
    }

    drawDivider(false, 8, 12);

    // 4. 12-POINT PRE-REPAIR INSPECTION CONDITION CHECKLIST
    drawSectionLabel('Pre-Repair Inspection Condition');
    const cols = isThermal ? 2 : 3;
    const cellGap = isThermal ? 10 : 16;
    const cellW = (contentWidth - cellGap * (cols - 1)) / cols;
    const rowH = isThermal ? 17 : 21;
    const rows = Math.ceil(CHECKLIST_ITEMS.length / cols);

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const idx = r * cols + c;
        if (idx >= CHECKLIST_ITEMS.length) continue;
        const label = CHECKLIST_ITEMS[idx];
        const st = checklist[idx] ?? 'UNTESTED';
        const shortText = st === 'WORKING' ? 'OK' : st === 'DEFECTIVE' ? 'ISSUE' : 'N/A';

        const cellX = padX + c * (cellW + cellGap);
        const cellY = y + r * rowH;

        if (shouldPaint) {
          setFont(700, isThermal ? 9.5 : 11.5);
          const statusWidth = ctx.measureText(shortText).width;
          ctx.fillStyle = '#000000';
          ctx.textAlign = 'right';
          ctx.textBaseline = 'top';
          ctx.fillText(shortText, cellX + cellW, cellY);

          setFont(400, isThermal ? 9.5 : 11.5);
          ctx.fillStyle = '#262626';
          ctx.textAlign = 'left';
          const fittedLabel = truncateText(ctx, label, cellW - statusWidth - 8);
          ctx.fillText(fittedLabel, cellX, cellY);

          ctx.save();
          ctx.strokeStyle = '#D4D4D4';
          ctx.lineWidth = 0.75;
          ctx.setLineDash([1.5, 2]);
          ctx.beginPath();
          ctx.moveTo(cellX, cellY + rowH - 3);
          ctx.lineTo(cellX + cellW, cellY + rowH - 3);
          ctx.stroke();
          ctx.restore();
        }
      }
    }
    y += rows * rowH;

    drawDivider(false, 8, 12);

    // 5. BILLING SUMMARY
    drawSectionLabel('Billing Summary');
    const drawBillingRow = (
      leftLabel: string,
      rightValue: string,
      bold = false,
      topBorder = false
    ) => {
      if (topBorder) {
        y += 4;
        if (shouldPaint) {
          ctx.save();
          ctx.strokeStyle = '#D4D4D4';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(padX, y);
          ctx.lineTo(logicalWidth - padX, y);
          ctx.stroke();
          ctx.restore();
        }
        y += 8;
      }

      const fontSize = isThermal ? 11 : 13.5;
      if (shouldPaint) {
        ctx.textBaseline = 'top';
        setFont(bold ? 700 : 400, fontSize);
        ctx.fillStyle = bold ? '#000000' : '#404040';
        ctx.textAlign = 'left';
        ctx.fillText(leftLabel, padX, y);

        setFont(bold ? 700 : 600, fontSize);
        ctx.fillStyle = '#000000';
        ctx.textAlign = 'right';
        ctx.fillText(rightValue, logicalWidth - padX, y);
      }
      y += isThermal ? 17 : 21;
    };

    drawBillingRow(
      job.finalCost > 0 ? 'Final Repair Cost' : 'Estimated Repair Cost',
      `${currency}${fin.totalCost.toLocaleString()}`
    );

    if (fin.discount > 0) {
      drawBillingRow('Discount', `- ${currency}${fin.discount.toLocaleString()}`);
    }

    drawBillingRow('Advance Paid', `- ${currency}${fin.advancePaid.toLocaleString()}`);

    drawBillingRow(
      fin.isFullyPaid
        ? `Status: PAID (${job.paymentMode || 'Cash'})`
        : `Balance Due (${job.paymentMode || 'Cash'})`,
      fin.isFullyPaid ? `${currency}0` : `${currency}${fin.balanceDue.toLocaleString()}`,
      true,
      true
    );

    drawDivider(false, 8, 12);

    // 6. DELIVERY HANDOVER (if delivered)
    if (job.stage === JobStage.DELIVERED) {
      drawSectionLabel('Delivery Handover');
      const recipientText = job.pickedUpByOriginalCustomer
        ? `${job.customerName} (Original Customer)`
        : `${job.recipientName || 'Representative'}${
            job.recipientPhone ? ` (${job.recipientPhone})` : ''
          }`;

      setFont(600, isThermal ? 10.5 : 13);
      y = drawWrapped(
        `Picked Up By: ${recipientText}`,
        padX,
        contentWidth,
        isThermal ? 15 : 19,
        '#000000'
      );

      if (job.deliveredAt) {
        y += 2;
        setFont(400, isThermal ? 10 : 12);
        y = drawWrapped(
          `Delivered On: ${new Date(job.deliveredAt).toLocaleString()}`,
          padX,
          contentWidth,
          isThermal ? 14 : 17,
          '#404040'
        );
      }

      drawDivider(false, 8, 12);
    }

    // 7. WARRANTY & TERMS
    setFont(600, isThermal ? 10.5 : 12.5);
    y = drawWrapped(
      `Service Warranty: ${warrantyDays} Days`,
      padX,
      contentWidth,
      isThermal ? 15 : 18,
      '#000000'
    );

    if (terms) {
      y += 4;
      setFont(400, isThermal ? 9.5 : 11.5);
      y = drawWrapped(terms, padX, contentWidth, isThermal ? 13.5 : 16.5, '#404040');
    }

    // 8. SIGNATURE BOXES
    drawDivider(true, 14, 18);

    if (isThermal) {
      const sigHeight = 32;
      const drawSigBlock = (label: string) => {
        y += sigHeight;
        if (shouldPaint) {
          ctx.save();
          ctx.strokeStyle = '#A3A3A3';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(padX, y);
          ctx.lineTo(logicalWidth - padX, y);
          ctx.stroke();
          ctx.restore();

          setFont(600, 10);
          ctx.fillStyle = '#404040';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'top';
          ctx.fillText(label, logicalWidth / 2, y + 5);
        }
        y += 22;
      };

      drawSigBlock('Customer Signature');
      y += 8;
      drawSigBlock('Authorized Shop Signature');
    } else {
      const sigGap = 40;
      const sigW = (contentWidth - sigGap) / 2;
      y += 40;
      if (shouldPaint) {
        ctx.save();
        ctx.strokeStyle = '#A3A3A3';
        ctx.lineWidth = 1;
        // Left line
        ctx.beginPath();
        ctx.moveTo(padX, y);
        ctx.lineTo(padX + sigW, y);
        ctx.stroke();
        // Right line
        ctx.beginPath();
        ctx.moveTo(padX + sigW + sigGap, y);
        ctx.lineTo(logicalWidth - padX, y);
        ctx.stroke();
        ctx.restore();

        setFont(600, 11);
        ctx.fillStyle = '#404040';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillText('Customer Signature', padX + sigW / 2, y + 6);
        ctx.fillText('Authorized Shop Signature', padX + sigW + sigGap + sigW / 2, y + 6);
      }
      y += 24;
    }

    return y + padY;
  };

  const totalLogicalHeight = Math.ceil(drawPass(measureCtx, false));

  const outputCanvas = document.createElement('canvas');
  outputCanvas.width = Math.round(logicalWidth * dpr);
  outputCanvas.height = Math.round(totalLogicalHeight * dpr);

  const ctx = outputCanvas.getContext('2d');
  if (!ctx) {
    throw new Error('Unable to initialize canvas rendering context for PDF generation.');
  }

  ctx.scale(dpr, dpr);
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, logicalWidth, totalLogicalHeight);

  drawPass(ctx, true);

  return outputCanvas;
}

export async function generateReceiptPdf(
  job: RepairJob,
  shopProfile: ShopProfile | null,
  layoutMode: ReceiptLayoutMode
): Promise<GeneratedReceiptPdf> {
  // Wait briefly for web fonts if available so receipt typography matches Print Receipt
  if (typeof document !== 'undefined' && 'fonts' in document) {
    try {
      await Promise.race([
        document.fonts.ready,
        new Promise((resolve) => window.setTimeout(resolve, 400)),
      ]);
    } catch {
      // Proceed with fallback system fonts
    }
  }

  const canvas = renderReceiptToCanvas({ job, shopProfile, layoutMode });
  const imgData = canvas.toDataURL('image/png');
  const fileName = buildReceiptFileName(job, layoutMode);

  let doc: jsPDF;

  if (layoutMode === 'thermal') {
    const pageWidthMm = 80;
    const marginMm = 2;
    const renderWidthMm = pageWidthMm - marginMm * 2;
    const renderHeightMm = (canvas.height / canvas.width) * renderWidthMm;
    const pageHeightMm = Math.max(90, Math.ceil(renderHeightMm + marginMm * 2));

    doc = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: [pageWidthMm, pageHeightMm],
      compress: true,
    });

    doc.addImage(imgData, 'PNG', marginMm, marginMm, renderWidthMm, renderHeightMm, undefined, 'FAST');
  } else {
    const pageWidthMm = 210;
    const pageHeightMm = 297;
    const marginMm = 8;
    const maxRenderW = pageWidthMm - marginMm * 2;
    const maxRenderH = pageHeightMm - marginMm * 2;

    let renderWidthMm = maxRenderW;
    let renderHeightMm = (canvas.height / canvas.width) * renderWidthMm;

    // Fit cleanly on a single A4 page when slightly taller; paginate only if extremely long
    if (renderHeightMm > maxRenderH && renderHeightMm <= maxRenderH * 1.35) {
      const scaleFactor = maxRenderH / renderHeightMm;
      renderWidthMm *= scaleFactor;
      renderHeightMm = maxRenderH;
    }

    doc = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: 'a4',
      compress: true,
    });

    if (renderHeightMm <= maxRenderH) {
      const offsetX = (pageWidthMm - renderWidthMm) / 2;
      doc.addImage(imgData, 'PNG', offsetX, marginMm, renderWidthMm, renderHeightMm, undefined, 'FAST');
    } else {
      // Multi-page slice for exceptionally long terms & conditions
      let remainingHeightMm = renderHeightMm;
      let offsetY = marginMm;
      let pageIndex = 0;

      while (remainingHeightMm > 0) {
        if (pageIndex > 0) {
          doc.addPage();
        }
        doc.addImage(imgData, 'PNG', marginMm, offsetY, renderWidthMm, renderHeightMm, undefined, 'FAST');
        remainingHeightMm -= maxRenderH;
        offsetY -= maxRenderH;
        pageIndex += 1;
      }
    }
  }

  const blob = doc.output('blob');
  const file = new File([blob], fileName, { type: 'application/pdf' });

  return { blob, file, fileName };
}

export async function shareReceiptPdfViaWhatsApp(params: {
  job: RepairJob;
  shopProfile: ShopProfile | null;
  layoutMode: ReceiptLayoutMode;
  whatsappUrl: string;
  messageText: string;
}): Promise<WhatsAppPdfShareResult> {
  const { job, shopProfile, layoutMode, whatsappUrl, messageText } = params;
  const { blob, file, fileName } = await generateReceiptPdf(job, shopProfile, layoutMode);

  // Prefer native Web Share API with PDF file attachment (mobile / supported desktop browsers)
  if (
    typeof navigator !== 'undefined' &&
    typeof navigator.share === 'function' &&
    typeof navigator.canShare === 'function'
  ) {
    try {
      const shareData: ShareData = {
        files: [file],
        title: `Repair Receipt - ${job.jobNumber}`,
        text: messageText,
      };
      if (navigator.canShare(shareData)) {
        await navigator.share(shareData);
        return { method: 'native-share', fileName };
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        return { method: 'cancelled', fileName };
      }
      // Fall through to desktop Download + WhatsApp Web handoff on unsupported/denied share
    }
  }

  // Desktop POS fallback: download the exact PDF and open the customer's WhatsApp chat
  triggerPdfDownload(blob, fileName);
  openExternalWhatsAppLink(whatsappUrl);

  return { method: 'download-and-open', fileName };
}
