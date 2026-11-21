import { useState } from 'react';
import {
  Download,
  FileText,
  Loader2,
  MessageCircle,
  Printer,
  Receipt,
  X,
} from 'lucide-react';
import {
  generateReceiptPdf,
  ReceiptLayoutMode,
  triggerPdfDownload,
} from '../services/receiptPdfService';
import {
  CHECKLIST_ITEMS,
  computeJobFinancials,
  JobStage,
  parseChecklist,
  RepairJob,
  ShopProfile,
  STAGE_LABELS,
} from '../types/repairShop';

interface ReceiptPrintModalProps {
  isOpen: boolean;
  job: RepairJob | null;
  shopProfile: ShopProfile | null;
  onClose: () => void;
  onShareWhatsApp?: (job: RepairJob, layoutMode: ReceiptLayoutMode) => void;
}

export function ReceiptPrintModal({
  isOpen,
  job,
  shopProfile,
  onClose,
  onShareWhatsApp,
}: ReceiptPrintModalProps) {
  const [layoutMode, setLayoutMode] = useState<ReceiptLayoutMode>('a4');
  const [isDownloadingPdf, setIsDownloadingPdf] = useState(false);

  if (!isOpen || !job) return null;

  const currency = shopProfile?.currencySymbol || '₹';
  const fin = computeJobFinancials(job);
  const checklist = parseChecklist(job.checklistJson);
  const shopName = shopProfile?.shopName || 'Mobile Repair Shop';
  const tagline = shopProfile?.tagline || '';
  const shopPhone = shopProfile?.contactPhone || '';
  const shopAddress = shopProfile?.address || '';
  const warrantyDays = shopProfile?.warrantyDays ?? 90;
  const terms = shopProfile?.termsAndConditions?.trim() || '';

  const isThermal = layoutMode === 'thermal';

  const handleDownloadPdf = async () => {
    if (isDownloadingPdf) return;
    setIsDownloadingPdf(true);
    try {
      const { blob, fileName } = await generateReceiptPdf(job, shopProfile, layoutMode);
      triggerPdfDownload(blob, fileName);
    } catch {
      // Keep modal resilient on generation error
    } finally {
      setIsDownloadingPdf(false);
    }
  };

  return (
    <div
      className="print-overlay-shell fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-sm dark:bg-slate-950/80"
      role="dialog"
      aria-modal="true"
      aria-labelledby="receipt-modal-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="print-modal-card flex max-h-[94vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700/80 dark:bg-[#0F172A]">
        {/* Modal Controls (hidden during print) */}
        <div className="no-print flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-slate-50 px-6 py-4 dark:border-slate-800 dark:bg-[#1E293B]">
          <div className="flex items-center gap-3">
            <h2
              id="receipt-modal-title"
              className="font-display text-base font-bold text-slate-900 dark:text-slate-100"
            >
              Print Job Card / Receipt
            </h2>
            <span className="rounded-lg border border-blue-200 bg-blue-50 px-2.5 py-0.5 font-mono-tabular text-xs font-semibold text-blue-700 dark:border-blue-500/35 dark:bg-blue-500/15 dark:text-blue-300">
              {job.jobNumber}
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <div
              className="inline-flex items-center rounded-xl border border-slate-200 bg-white p-1 dark:border-slate-700 dark:bg-[#0F172A]"
              role="group"
              aria-label="Receipt layout mode"
            >
              <button
                type="button"
                onClick={() => setLayoutMode('a4')}
                className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                  layoutMode === 'a4'
                    ? 'bg-[#2563EB] text-white'
                    : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'
                }`}
              >
                <FileText className="h-3.5 w-3.5" />
                <span>A4 Invoice</span>
              </button>
              <button
                type="button"
                onClick={() => setLayoutMode('thermal')}
                className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                  layoutMode === 'thermal'
                    ? 'bg-[#2563EB] text-white'
                    : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'
                }`}
              >
                <Receipt className="h-3.5 w-3.5" />
                <span>80mm Thermal</span>
              </button>
            </div>

            <button
              type="button"
              onClick={handleDownloadPdf}
              disabled={isDownloadingPdf}
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-100 hover:text-slate-900 disabled:opacity-60 dark:border-slate-700 dark:bg-[#0F172A] dark:text-slate-200 dark:hover:bg-slate-800"
            >
              {isDownloadingPdf ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Download className="h-3.5 w-3.5" />
              )}
              <span>Download PDF</span>
            </button>

            {onShareWhatsApp && (
              <button
                type="button"
                onClick={() => onShareWhatsApp(job, layoutMode)}
                className="inline-flex items-center gap-1.5 rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 py-2 text-xs font-semibold text-emerald-700 transition-colors hover:bg-emerald-100 dark:border-emerald-500/35 dark:bg-emerald-500/15 dark:text-emerald-300 dark:hover:bg-emerald-500/25"
              >
                <MessageCircle className="h-3.5 w-3.5" />
                <span>WhatsApp PDF</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => window.print()}
              className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-emerald-500"
            >
              <Printer className="h-4 w-4" />
              <span>Print</span>
            </button>

            <button
              type="button"
              onClick={onClose}
              className="rounded-lg p-2 text-slate-500 hover:bg-slate-200 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
              aria-label="Close receipt preview"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Receipt Preview Canvas */}
        <div className="print-scroll-area flex-1 overflow-y-auto bg-slate-200/75 p-6 dark:bg-slate-900/80">
          <div
            id="printable-receipt-root"
            className={`mx-auto bg-white text-black shadow-xl ${
              isThermal
                ? 'thermal-mode w-[302px] p-4 text-[11px] leading-snug font-mono'
                : 'a4-mode max-w-[760px] rounded-lg p-8 text-sm leading-normal'
            }`}
          >
            {/* Shop Header */}
            <div
              className={`border-b border-neutral-300 pb-3 ${
                isThermal ? 'text-center' : 'flex items-start justify-between gap-6'
              }`}
            >
              <div>
                <h1
                  className={`font-bold tracking-tight text-black ${
                    isThermal ? 'text-base uppercase' : 'text-2xl'
                  }`}
                >
                  {shopName}
                </h1>
                {tagline && (
                  <p className="mt-0.5 text-neutral-700 text-xs">{tagline}</p>
                )}
                {shopAddress && (
                  <p className="mt-1 text-neutral-700 text-xs">{shopAddress}</p>
                )}
                {shopPhone && (
                  <p className="mt-0.5 font-semibold text-neutral-800 text-xs">
                    Tel: {shopPhone}
                  </p>
                )}
              </div>

              <div className={isThermal ? 'mt-2 border-t border-dashed border-neutral-400 pt-2' : 'text-right'}>
                <p className="font-bold text-black">
                  {isThermal ? `JOB: ${job.jobNumber}` : 'REPAIR JOB CARD / INVOICE'}
                </p>
                {!isThermal && (
                  <p className="mt-0.5 font-mono text-base font-bold text-black">
                    {job.jobNumber}
                  </p>
                )}
                <p className="mt-0.5 text-xs text-neutral-700">
                  Date: {new Date(job.createdAt).toLocaleString()}
                </p>
                <p className="mt-0.5 text-xs font-semibold text-black">
                  Stage: {STAGE_LABELS[job.stage]}
                </p>
              </div>
            </div>

            {/* Customer & Device Section */}
            <div
              className={`border-b border-neutral-300 py-3 ${
                isThermal ? 'space-y-2' : 'grid grid-cols-2 gap-6'
              }`}
            >
              <div>
                <h2 className="text-[11px] font-bold uppercase tracking-wider text-neutral-600">
                  Customer
                </h2>
                <p className="mt-0.5 font-semibold text-black">
                  {job.customerName || 'Walk-in Customer'}
                </p>
                <p className="text-neutral-800">{job.customerPhone || '—'}</p>
              </div>

              <div>
                <h2 className="text-[11px] font-bold uppercase tracking-wider text-neutral-600">
                  Device
                </h2>
                <p className="mt-0.5 font-semibold text-black">
                  {[job.deviceBrand, job.deviceModel, job.deviceColor ? `(${job.deviceColor})` : '']
                    .filter(Boolean)
                    .join(' ') || 'Device unspecified'}
                </p>
                <p className="text-neutral-800">
                  IMEI/SN: {job.imeiOrSerial || '—'}
                </p>
              </div>
            </div>

            {/* Fault & Complaint */}
            <div className="border-b border-neutral-300 py-3">
              <h2 className="text-[11px] font-bold uppercase tracking-wider text-neutral-600">
                Reported Fault
              </h2>
              <p className="mt-1 text-black">{job.issueDescription || '—'}</p>
              {job.issueTagsCsv && (
                <p className="mt-1 text-xs text-neutral-700">
                  Tags: {job.issueTagsCsv}
                </p>
              )}
            </div>

            {/* 12-Point Intake Condition Checklist */}
            <div className="border-b border-neutral-300 py-3">
              <h2 className="text-[11px] font-bold uppercase tracking-wider text-neutral-600">
                Pre-Repair Inspection Condition
              </h2>
              <div
                className={`mt-1.5 grid gap-x-3 gap-y-1 ${
                  isThermal ? 'grid-cols-2 text-[10px]' : 'grid-cols-3 text-xs'
                }`}
              >
                {CHECKLIST_ITEMS.map((label, idx) => {
                  const st = checklist[idx] ?? 'UNTESTED';
                  const shortText =
                    st === 'WORKING' ? 'OK' : st === 'DEFECTIVE' ? 'ISSUE' : 'N/A';
                  return (
                    <div
                      key={label}
                      className="flex items-center justify-between border-b border-dotted border-neutral-300 py-0.5"
                    >
                      <span className="truncate pr-1 text-neutral-800">{label}</span>
                      <span className="font-bold text-black">{shortText}</span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Cost Breakdown */}
            <div className="border-b border-neutral-300 py-3">
              <h2 className="text-[11px] font-bold uppercase tracking-wider text-neutral-600">
                Billing Summary
              </h2>
              <div className="mt-1.5 space-y-1">
                <div className="flex justify-between">
                  <span className="text-neutral-700">
                    {job.finalCost > 0 ? 'Final Repair Cost' : 'Estimated Repair Cost'}
                  </span>
                  <span className="font-semibold text-black">
                    {currency}
                    {fin.totalCost.toLocaleString()}
                  </span>
                </div>
                {fin.discount > 0 && (
                  <div className="flex justify-between">
                    <span className="text-neutral-700">Discount</span>
                    <span className="text-black">
                      - {currency}
                      {fin.discount.toLocaleString()}
                    </span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-neutral-700">Advance Paid</span>
                  <span className="text-black">
                    - {currency}
                    {fin.advancePaid.toLocaleString()}
                  </span>
                </div>
                <div className="flex justify-between border-t border-neutral-300 pt-1.5 font-bold text-black">
                  <span>
                    {fin.isFullyPaid
                      ? `Status: PAID (${job.paymentMode || 'Cash'})`
                      : `Balance Due (${job.paymentMode || 'Cash'})`}
                  </span>
                  <span>
                    {fin.isFullyPaid
                      ? `${currency}0`
                      : `${currency}${fin.balanceDue.toLocaleString()}`}
                  </span>
                </div>
              </div>
            </div>

            {/* Delivery Handover Details (if delivered) */}
            {job.stage === JobStage.DELIVERED && (
              <div className="border-b border-neutral-300 py-3">
                <h2 className="text-[11px] font-bold uppercase tracking-wider text-neutral-600">
                  Delivery Handover
                </h2>
                <p className="mt-1 text-black">
                  Picked Up By:{' '}
                  <strong>
                    {job.pickedUpByOriginalCustomer
                      ? `${job.customerName} (Original Customer)`
                      : `${job.recipientName || 'Representative'}${
                          job.recipientPhone ? ` (${job.recipientPhone})` : ''
                        }`}
                  </strong>
                </p>
                {job.deliveredAt && (
                  <p className="mt-0.5 text-xs text-neutral-700">
                    Delivered On: {new Date(job.deliveredAt).toLocaleString()}
                  </p>
                )}
              </div>
            )}

            {/* Warranty & Terms */}
            <div className="py-3 text-xs text-neutral-700">
              <p className="font-semibold text-black">
                Service Warranty: {warrantyDays} Days
              </p>
              {terms && <p className="mt-1 whitespace-pre-line">{terms}</p>}
            </div>

            {/* Signature Boxes */}
            <div
              className={`mt-4 pt-6 border-t border-dashed border-neutral-400 ${
                isThermal ? 'space-y-6' : 'grid grid-cols-2 gap-10'
              }`}
            >
              <div>
                <div className="h-10 border-b border-neutral-400" />
                <p className="mt-1 text-center text-[11px] font-semibold text-neutral-700">
                  Customer Signature
                </p>
              </div>
              <div>
                <div className="h-10 border-b border-neutral-400" />
                <p className="mt-1 text-center text-[11px] font-semibold text-neutral-700">
                  Authorized Shop Signature
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
