import { forwardRef } from 'react';
import { clsx } from 'clsx';
import type { CartItem } from '@/types';
import { formatCurrency, formatDate } from '@/utils/format';
import { APP_NAME } from '@/utils/constants';

export interface ReceiptData {
  reference: string;
  customerName: string;
  items: CartItem[];
  subtotal: number;
  taxAmount: number;
  discountAmount: number;
  totalAmount: number;
  paymentMethod: string;
  amountPaid: number;
  changeAmount: number;
  amountOwed?: number;    // balance still owed — present and > 0 for credit/partial sales
  cashierName?: string;
  timestamp: string;
  businessName?: string;
  businessAddress?: string;
  businessPhone?: string;
  branchName?: string;    // active branch name shown on receipt
  branchPhone?: string;   // active branch phone — shown instead of / in addition to business phone
}

interface ReceiptProps {
  data: ReceiptData;
  forThermal?: boolean;
}

const PAYMENT_LABELS: Record<string, string> = {
  CASH: 'Cash',
  MOBILE_MONEY: 'Mobile Money',
  CARD: 'Card',
  BANK_TRANSFER: 'Bank Transfer',
  CHEQUE: 'Cheque',
};

export const Receipt = forwardRef<HTMLDivElement, ReceiptProps>(
  ({ data, forThermal = false }, ref) => {
    const {
      reference,
      customerName,
      items,
      subtotal,
      taxAmount,
      discountAmount,
      totalAmount,
      paymentMethod,
      amountPaid,
      changeAmount,
      amountOwed,
      cashierName,
      timestamp,
      businessName = APP_NAME,
      businessAddress = '',
      businessPhone = '',
      branchName = '',
      branchPhone = '',
    } = data;

    // Phone line: prefer branch phone, fall back to business phone
    const displayPhone = branchPhone || businessPhone;

    const totalQty = items.reduce((s, i) => s + i.quantity, 0);

    if (forThermal) {
      return (
        <div
          ref={ref}
          className="receipt-thermal w-[300px] bg-white text-black font-mono text-[11px] leading-tight p-4 mx-auto"
          style={{ fontFamily: 'monospace', fontSize: '11px', lineHeight: 1.4 }}
        >
          <div className="text-center border-b border-dashed border-black pb-2 mb-2">
            <div className="font-bold text-base">{businessName}</div>
            {businessAddress && <div className="mt-1">{businessAddress}</div>}
            {branchName && (
              <div className="text-[10px] font-semibold mt-0.5">{branchName}</div>
            )}
            {displayPhone && <div>Tel: {displayPhone}</div>}
            {/* Show both if branch phone differs from business phone */}
            {branchPhone && businessPhone && branchPhone !== businessPhone && (
              <div className="text-[10px]">Main: {businessPhone}</div>
            )}
          </div>

          <div className="border-b border-dashed border-black pb-2 mb-2 space-y-0.5">
            <div className="flex justify-between">
              <span>Receipt #:</span>
              <span className="font-bold">{reference}</span>
            </div>
            <div className="flex justify-between">
              <span>Date:</span>
              <span>{formatDate(timestamp, 'DD/MM/YYYY HH:mm')}</span>
            </div>
            <div className="flex justify-between">
              <span>Cashier:</span>
              <span>{cashierName || 'Cashier'}</span>
            </div>
            <div className="flex justify-between">
              <span>Customer:</span>
              <span>{customerName || 'Walk-in'}</span>
            </div>
          </div>

          <div className="border-b border-dashed border-black pb-2 mb-2">
            <table className="w-full border-collapse">
              <thead>
                <tr className="font-bold">
                  <th className="text-left py-1">Item</th>
                  <th className="text-right py-1">Qty</th>
                  <th className="text-right py-1">Amt</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id} className="align-top">
                    <td className="py-0.5 pr-2">
                      <div className="font-semibold truncate" style={{ maxWidth: '140px' }}>
                        {item.name}
                      </div>
                      <div className="text-[10px] text-gray-700">
                        @ {formatCurrency(item.price)}
                      </div>
                    </td>
                    <td className="text-right py-0.5">{item.quantity}</td>
                    <td className="text-right py-0.5 font-semibold whitespace-nowrap">
                      {formatCurrency(item.subtotal)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="space-y-1 border-b border-dashed border-black pb-2 mb-2">
            <div className="flex justify-between">
              <span>Items ({totalQty}):</span>
              <span>{formatCurrency(subtotal)}</span>
            </div>
            {taxAmount > 0 && (
              <div className="flex justify-between">
                <span>VAT/Tax:</span>
                <span>{formatCurrency(taxAmount)}</span>
              </div>
            )}
            {discountAmount > 0 && (
              <div className="flex justify-between">
                <span>Discount:</span>
                <span>-{formatCurrency(discountAmount)}</span>
              </div>
            )}
            <div className="flex justify-between font-bold text-sm pt-1 border-t border-dotted border-black">
              <span>TOTAL:</span>
              <span>{formatCurrency(totalAmount)}</span>
            </div>
          </div>

          <div className="space-y-1 border-b border-dashed border-black pb-2 mb-2">
            <div className="flex justify-between">
              <span>Payment:</span>
              <span>{PAYMENT_LABELS[paymentMethod] || paymentMethod}</span>
            </div>
            <div className="flex justify-between">
              <span>Amount Paid:</span>
              <span>{formatCurrency(amountPaid)}</span>
            </div>
            {changeAmount > 0 && (
              <div className="flex justify-between">
                <span>Change:</span>
                <span className="font-semibold">{formatCurrency(changeAmount)}</span>
              </div>
            )}
            {amountOwed && amountOwed > 0 ? (
              <div className="flex justify-between font-bold pt-1 border-t border-dotted border-black">
                <span>BALANCE OWED:</span>
                <span style={{ color: '#b91c1c' }}>{formatCurrency(amountOwed)}</span>
              </div>
            ) : null}
          </div>

          <div className="text-center pt-2">
            <div className="font-bold">Thank you for your purchase!</div>
            <div className="mt-1 text-[10px]">Please come again</div>
            <div className="mt-3 text-[10px]">
              {businessName} © {new Date(timestamp).getFullYear()}
            </div>
          </div>
        </div>
      );
    }

    return (
      <div
        ref={ref}
        className="receipt-a4 w-full max-w-2xl mx-auto bg-white text-muted-900 p-8 font-sans"
      >
        <div className="border-b-2 border-muted-200 pb-6 mb-6 flex justify-between items-start">
          <div>
            <h1 className="text-2xl font-bold text-primary-700">{businessName}</h1>
            {businessAddress && <p className="text-sm text-muted-600 mt-1">{businessAddress}</p>}
            {branchName && (
              <p className="text-sm font-semibold text-muted-700 mt-0.5">{branchName}</p>
            )}
            {displayPhone && <p className="text-sm text-muted-600">Tel: {displayPhone}</p>}
            {branchPhone && businessPhone && branchPhone !== businessPhone && (
              <p className="text-xs text-muted-500">Main: {businessPhone}</p>
            )}
          </div>
          <div className="text-right">
            <div className="inline-block border-2 border-primary-200 rounded-xl bg-primary-50 px-5 py-3">
              <p className="text-[10px] text-muted-500 font-semibold uppercase tracking-wider">Receipt</p>
              <p className="text-xl font-bold text-primary-700 mt-0.5">{reference}</p>
            </div>
            <p className="text-sm text-muted-500 mt-3">{formatDate(timestamp, 'DD MMM YYYY, HH:mm')}</p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-6 mb-6">
          <div className="bg-muted-50 rounded-xl p-4">
            <p className="text-[10px] text-muted-500 font-semibold uppercase tracking-wider">Customer</p>
            <p className="text-sm font-semibold text-muted-900 mt-1">{customerName || 'Walk-in Customer'}</p>
          </div>
          <div className="bg-muted-50 rounded-xl p-4">
            <p className="text-[10px] text-muted-500 font-semibold uppercase tracking-wider">Cashier</p>
            <p className="text-sm font-semibold text-muted-900 mt-1">{cashierName || 'POPMYC Cashier'}</p>
          </div>
        </div>

        <div className="mb-6 overflow-hidden rounded-xl border border-muted-200">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted-100 border-b border-muted-200">
                <th className="text-left px-4 py-3 font-semibold text-muted-700">Item</th>
                <th className="text-right px-4 py-3 font-semibold text-muted-700 w-24">Qty</th>
                <th className="text-right px-4 py-3 font-semibold text-muted-700 w-32">Unit</th>
                <th className="text-right px-4 py-3 font-semibold text-muted-700 w-36">Amount</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item, idx) => (
                <tr
                  key={item.id}
                  className={idx !== items.length - 1 ? 'border-b border-muted-100' : ''}
                >
                  <td className="px-4 py-3">
                    <div className="font-semibold text-muted-900">{item.name}</div>
                    <div className="text-xs text-muted-500 font-mono">{item.sku}</div>
                  </td>
                  <td className="px-4 py-3 text-right text-muted-700">{item.quantity}</td>
                  <td className="px-4 py-3 text-right text-muted-700">{formatCurrency(item.price)}</td>
                  <td className="px-4 py-3 text-right font-semibold text-muted-900">
                    {formatCurrency(item.subtotal)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div />
          <div className="bg-muted-50 rounded-xl border border-muted-200 p-5 space-y-3">
            <div className="flex justify-between text-sm">
              <span className="text-muted-600">Subtotal ({totalQty} items)</span>
              <span className="font-semibold text-muted-900">{formatCurrency(subtotal)}</span>
            </div>
            {taxAmount > 0 && (
              <div className="flex justify-between text-sm">
                <span className="text-muted-600">VAT / Tax</span>
                <span className="font-semibold text-muted-900">{formatCurrency(taxAmount)}</span>
              </div>
            )}
            {discountAmount > 0 && (
              <div className="flex justify-between text-sm">
                <span className="text-muted-600">Discount</span>
                <span className="font-semibold text-success-700">-{formatCurrency(discountAmount)}</span>
              </div>
            )}
            <div className="flex justify-between pt-3 border-t border-muted-200">
              <span className="text-base font-bold text-muted-900">Grand Total</span>
              <span className="text-2xl font-bold text-primary-700">{formatCurrency(totalAmount)}</span>
            </div>
          </div>
        </div>

        <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="bg-muted-50 rounded-xl border border-muted-200 p-5 space-y-3">
            <p className="text-[10px] text-muted-500 font-semibold uppercase tracking-wider mb-1">Payment Details</p>
            <div className="flex justify-between text-sm">
              <span className="text-muted-600">Method</span>
              <span className="font-semibold text-muted-900">
                {PAYMENT_LABELS[paymentMethod] || paymentMethod}
              </span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-600">Amount Paid</span>
              <span className="font-semibold text-success-700">{formatCurrency(amountPaid)}</span>
            </div>
            {changeAmount > 0 && (
              <div className="flex justify-between text-sm">
                <span className="text-muted-600">Change Due</span>
                <span className="font-semibold text-warning-700">{formatCurrency(changeAmount)}</span>
              </div>
            )}
            {amountOwed && amountOwed > 0 ? (
              <div className="flex justify-between text-sm pt-2 border-t border-dashed border-rose-200 mt-1">
                <span className="font-bold text-rose-700">Balance Owed</span>
                <span className="font-bold text-rose-700 text-base">{formatCurrency(amountOwed)}</span>
              </div>
            ) : null}
          </div>
          <div className={clsx(
            'rounded-xl border p-5 flex flex-col items-center justify-center text-center',
            amountOwed && amountOwed > 0
              ? 'bg-rose-50 border-rose-200'
              : 'bg-gradient-to-br from-primary-50 to-secondary-50 border-primary-200'
          )}>
            {amountOwed && amountOwed > 0 ? (
              <>
                <p className="text-base font-bold text-rose-700 mb-1">Credit Sale</p>
                <p className="text-sm text-rose-600">Balance outstanding</p>
                <p className="text-2xl font-bold text-rose-700 mt-2">{formatCurrency(amountOwed)}</p>
                <p className="text-xs text-rose-500 mt-2">Please settle balance promptly</p>
              </>
            ) : (
              <>
                <p className="text-lg font-bold text-primary-700 mb-1">Thank You!</p>
                <p className="text-sm text-muted-600">for your purchase</p>
              </>
            )}
            <p className="text-xs text-muted-500 mt-3">
              {businessName} © {new Date(timestamp).getFullYear()}
            </p>
          </div>
        </div>
      </div>
    );
  }
);

Receipt.displayName = 'Receipt';

export function printReceipt(data: ReceiptData): void {
  const printWindow = window.open('', '_blank', 'width=400,height=700,scrollbars=yes');
  if (!printWindow) {
    console.warn('Pop-up blocked. Printing in main window.');
  }

  const container = document.createElement('div');
  container.className = 'receipt-thermal w-[300px] bg-white text-black font-mono text-[11px] leading-tight p-4 mx-auto';
  container.style.fontFamily = 'monospace';
  container.style.fontSize = '11px';
  container.style.lineHeight = '1.4';
  container.style.color = 'black';
  container.style.background = 'white';
  container.style.width = '300px';
  container.style.maxWidth = '300px';
  container.style.margin = '0 auto';
  container.style.padding = '16px';

  const totalQty = data.items.reduce((s, i) => s + i.quantity, 0);
  const businessName    = data.businessName    || APP_NAME;
  const businessAddress = data.businessAddress || '';
  const businessPhone   = data.businessPhone   || '';
  const branchName      = data.branchName      || '';
  const branchPhone     = data.branchPhone     || '';
  // Prefer branch phone; show both only if they differ
  const displayPhone    = branchPhone || businessPhone;

  const esc = (s: string | number): string => {
    const div = document.createElement('div');
    div.textContent = String(s);
    return div.innerHTML;
  };

  container.innerHTML = `
    <div style="text-align:center; border-bottom:1px dashed #000; padding-bottom:8px; margin-bottom:8px;">
      <div style="font-weight:bold; font-size:16px;">${esc(businessName)}</div>
      ${businessAddress ? `<div style="margin-top:4px;">${esc(businessAddress)}</div>` : ''}
      ${branchName ? `<div style="font-size:10px; font-weight:600; margin-top:2px;">${esc(branchName)}</div>` : ''}
      ${displayPhone ? `<div>Tel: ${esc(displayPhone)}</div>` : ''}
      ${branchPhone && businessPhone && branchPhone !== businessPhone ? `<div style="font-size:10px;">Main: ${esc(businessPhone)}</div>` : ''}
    </div>

    <div style="border-bottom:1px dashed #000; padding-bottom:8px; margin-bottom:8px;">
      <div style="display:flex; justify-content:space-between;">
        <span>Receipt #:</span><span style="font-weight:bold;">${esc(data.reference)}</span>
      </div>
      <div style="display:flex; justify-content:space-between;">
        <span>Date:</span><span>${esc(formatDate(data.timestamp, 'DD/MM/YYYY HH:mm'))}</span>
      </div>
      <div style="display:flex; justify-content:space-between;">
        <span>Cashier:</span><span>${esc(data.cashierName || 'Cashier')}</span>
      </div>
      <div style="display:flex; justify-content:space-between;">
        <span>Customer:</span><span>${esc(data.customerName || 'Walk-in')}</span>
      </div>
    </div>

    <div style="border-bottom:1px dashed #000; padding-bottom:8px; margin-bottom:8px;">
      ${data.items.map((item) => `
        <div style="margin-bottom:4px;">
          <div style="font-weight:600;">${esc(item.name)}</div>
          <div style="display:flex; justify-content:space-between; font-size:10px; color:#555;">
            <span>${item.quantity} x ${esc(formatCurrency(item.price))}</span>
            <span style="font-weight:600; color:#000;">${esc(formatCurrency(item.subtotal))}</span>
          </div>
        </div>
      `).join('')}
    </div>

    <div style="border-bottom:1px dashed #000; padding-bottom:8px; margin-bottom:8px;">
      <div style="display:flex; justify-content:space-between;">
        <span>Items (${totalQty}):</span><span>${esc(formatCurrency(data.subtotal))}</span>
      </div>
      ${data.taxAmount > 0 ? `<div style="display:flex; justify-content:space-between;"><span>VAT/Tax:</span><span>${esc(formatCurrency(data.taxAmount))}</span></div>` : ''}
      ${data.discountAmount > 0 ? `<div style="display:flex; justify-content:space-between;"><span>Discount:</span><span>-${esc(formatCurrency(data.discountAmount))}</span></div>` : ''}
      <div style="display:flex; justify-content:space-between; font-weight:bold; font-size:13px; padding-top:4px; border-top:1px dotted #000;">
        <span>TOTAL:</span><span>${esc(formatCurrency(data.totalAmount))}</span>
      </div>
    </div>

    <div style="border-bottom:1px dashed #000; padding-bottom:8px; margin-bottom:8px;">
      <div style="display:flex; justify-content:space-between;">
        <span>Payment:</span><span>${esc(PAYMENT_LABELS[data.paymentMethod] || data.paymentMethod)}</span>
      </div>
      <div style="display:flex; justify-content:space-between;">
        <span>Amount Paid:</span><span>${esc(formatCurrency(data.amountPaid))}</span>
      </div>
      ${data.changeAmount > 0 ? `<div style="display:flex; justify-content:space-between;"><span>Change:</span><span style="font-weight:600;">${esc(formatCurrency(data.changeAmount))}</span></div>` : ''}
      ${data.amountOwed && data.amountOwed > 0 ? `<div style="display:flex; justify-content:space-between; font-weight:bold; padding-top:4px; border-top:1px dotted #000; color:#b91c1c;"><span>BALANCE OWED:</span><span>${esc(formatCurrency(data.amountOwed))}</span></div>` : ''}
    </div>

    <div style="text-align:center; padding-top:8px;">
      ${data.amountOwed && data.amountOwed > 0
        ? `<div style="font-weight:bold; color:#b91c1c;">CREDIT SALE</div>
           <div style="margin-top:2px; font-weight:bold; font-size:14px; color:#b91c1c;">Balance Owed: ${esc(formatCurrency(data.amountOwed))}</div>
           <div style="margin-top:4px; font-size:10px; color:#b91c1c;">Please settle balance promptly</div>`
        : `<div style="font-weight:bold;">Thank you for your purchase!</div>
           <div style="margin-top:4px; font-size:10px;">Please come again</div>`
      }
      <div style="margin-top:12px; font-size:10px;">${esc(businessName)} © ${new Date(data.timestamp).getFullYear()}</div>
    </div>
  `;

  if (printWindow) {
    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Receipt ${data.reference}</title>
        <style>
          @page { size: auto; margin: 8mm; }
          * { box-sizing: border-box; }
          body { margin: 0; padding: 0; background: white; display: flex; justify-content: center; }
          @media print {
            body { background: white; }
            @page { margin: 5mm; size: 80mm auto; }
          }
        </style>
      </head>
      <body>
        ${container.outerHTML}
      </body>
      </html>
    `);
    printWindow.document.close();
    setTimeout(() => {
      try {
        printWindow.focus();
        printWindow.print();
      } catch {
        console.warn('Print failed silently');
      }
    }, 250);
  } else {
    const printRoot = document.createElement('div');
    printRoot.id = 'receipt-print-root';
    printRoot.style.position = 'fixed';
    printRoot.style.left = '-9999px';
    printRoot.style.top = '0';
    printRoot.appendChild(container);
    document.body.appendChild(printRoot);

    const style = document.createElement('style');
    style.id = 'receipt-print-style';
    style.textContent = `
      @media print {
        body * { visibility: hidden !important; }
        #receipt-print-root, #receipt-print-root * { visibility: visible !important; }
        #receipt-print-root { position: absolute; left: 0; top: 0; width: 100%; }
        @page { size: 80mm auto; margin: 5mm; }
      }
    `;
    document.head.appendChild(style);

    setTimeout(() => {
      try {
        window.print();
      } catch {
        console.warn('Print failed silently');
      }
      setTimeout(() => {
        printRoot.remove();
        style.remove();
      }, 500);
    }, 200);
  }
}

export default Receipt;
