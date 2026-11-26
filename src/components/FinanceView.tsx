import React, { useEffect, useState } from 'react';
import { CreditCard, FilePlus2, Printer, RotateCcw, X } from 'lucide-react';
import { apiGet, apiPost } from '../api/client';
import { formatCurrency } from '../shared/rules';

interface InvoiceRow {
  id: number;
  invoice_number: string;
  student_id: number;
  student_name: string;
  student_code: string;
  class_name: string;
  section: string;
  billing_period: string;
  due_date: string;
  subtotal_cents: number;
  discount_cents: number;
  total_cents: number;
  paid_cents: number;
  status: string;
}

interface PaymentRow {
  id: number;
  receipt_number: string;
  invoice_number: string;
  student_name: string;
  student_code: string;
  amount_cents: number;
  method: string;
  reference_no: string;
  payment_date: string;
  received_by: string;
  is_reversal: number;
}

export const FinanceView: React.FC = () => {
  const [invoices, setInvoices] = useState<InvoiceRow[]>([]);
  const [payments, setPayments] = useState<PaymentRow[]>([]);
  const [categories, setCategories] = useState<Array<{ id: number; name: string; frequency: string; default_amount_cents: number }>>([]);
  const [totals, setTotals] = useState({
    billedCents: 0,
    collectedCents: 0,
    outstandingCents: 0,
    overdueCents: 0,
    discountsCents: 0,
  });

  // Payment Modal
  const [payInvoice, setPayInvoice] = useState<InvoiceRow | null>(null);
  const [payAmount, setPayAmount] = useState('');
  const [payMethod, setPayMethod] = useState('Bank Transfer');
  const [payRef, setPayRef] = useState('');

  // Receipt Modal
  const [receipt, setReceipt] = useState<PaymentRow | null>(null);

  // Batch Invoice Generator
  const [billingPeriod, setBillingPeriod] = useState('Spring 2027');
  const [dueDate, setDueDate] = useState('2027-01-15');
  const [batchClass, setBatchClass] = useState('');
  const [msg, setMsg] = useState('');

  const load = async () => {
    const res = await apiGet<{
      categories: typeof categories;
      invoices: InvoiceRow[];
      payments: PaymentRow[];
      totals: typeof totals;
    }>('/api/finance/summary');
    setCategories(res.categories);
    setInvoices(res.invoices);
    setPayments(res.payments);
    setTotals(res.totals);
  };

  useEffect(() => {
    load();
  }, []);

  const handleGenerateInvoices = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = await apiPost<{ created: number; skippedExisting: number }>('/api/invoices/generate', {
      class_name: batchClass || undefined,
      billing_period: billingPeriod,
      due_date: dueDate,
      items: [
        { category: 'Tuition Fee', amount: 1800 },
        { category: 'Laboratory Fee', amount: 250 },
      ],
    });
    setMsg(`Generated ${res.created} invoice(s); ${res.skippedExisting} already billed for ${billingPeriod}.`);
    load();
  };

  const handleRecordPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!payInvoice) return;
    const res = await apiPost<{ receiptNumber: string; payment: PaymentRow }>('/api/payments', {
      invoice_id: payInvoice.id,
      amount: Number(payAmount),
      method: payMethod,
      reference_no: payRef,
    });
    setPayInvoice(null);
    setPayAmount('');
    setPayRef('');
    setMsg(`Payment recorded — Receipt ${res.receiptNumber} issued.`);
    setReceipt({
      ...res.payment,
      invoice_number: payInvoice.invoice_number,
      student_name: payInvoice.student_name,
      student_code: payInvoice.student_code,
    });
    load();
  };

  const handleReversePayment = async (paymentId: number, receiptNo: string) => {
    await apiPost(`/api/payments/${paymentId}/reverse`, {
      reason: `Audited reversal of ${receiptNo}`,
    });
    setMsg(`Created audited reversal entry for ${receiptNo}.`);
    load();
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-slate-900">Fees, Billing, Scholarships & Receipts</h2>
        <p className="text-xs text-slate-500 mt-0.5">
          Integer-cents financial engine, automated billing periods, numbered receipts, and audited payment reversals.
        </p>
      </div>

      {msg && (
        <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-medium px-4 py-2.5 rounded-lg">
          {msg}
        </div>
      )}

      {/* Financial KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="text-xs text-slate-500">Total Billed</div>
          <div className="text-lg font-bold text-slate-900 mt-1 tabular-nums">{formatCurrency(totals.billedCents)}</div>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="text-xs text-slate-500">Collected</div>
          <div className="text-lg font-bold text-emerald-700 mt-1 tabular-nums">{formatCurrency(totals.collectedCents)}</div>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="text-xs text-slate-500">Outstanding</div>
          <div className="text-lg font-bold text-slate-900 mt-1 tabular-nums">{formatCurrency(totals.outstandingCents)}</div>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="text-xs text-slate-500">Overdue</div>
          <div className="text-lg font-bold text-red-700 mt-1 tabular-nums">{formatCurrency(totals.overdueCents)}</div>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="text-xs text-slate-500">Scholarships / Discounts</div>
          <div className="text-lg font-bold text-blue-800 mt-1 tabular-nums">{formatCurrency(totals.discountsCents)}</div>
        </div>
      </div>

      {/* Batch Invoice Generator */}
      <form onSubmit={handleGenerateInvoices} className="bg-white border border-slate-200 rounded-xl p-5 flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-[180px]">
          <label className="block text-xs font-medium text-slate-700 mb-1">Billing Period</label>
          <input
            type="text"
            required
            value={billingPeriod}
            onChange={(e) => setBillingPeriod(e.target.value)}
            className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded-lg"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1">Due Date</label>
          <input
            type="date"
            required
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            className="px-3 py-1.5 text-xs border border-slate-300 rounded-lg"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1">Class Filter</label>
          <select
            value={batchClass}
            onChange={(e) => setBatchClass(e.target.value)}
            className="px-3 py-1.5 text-xs border border-slate-300 rounded-lg bg-white"
          >
            <option value="">All Active Students</option>
            <option value="BSCS-1">BSCS-1</option>
            <option value="BSCS-2">BSCS-2</option>
            <option value="BSDA-1">BSDA-1</option>
          </select>
        </div>
        <button
          type="submit"
          className="inline-flex items-center gap-1.5 px-4 py-2 bg-blue-800 hover:bg-blue-900 text-white text-xs font-medium rounded-lg"
        >
          <FilePlus2 className="w-3.5 h-3.5" />
          <span>Generate Billing Invoices</span>
        </button>
      </form>

      {/* Invoices Table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-200 flex justify-between items-center">
          <h3 className="text-sm font-semibold text-slate-900">Student Invoices</h3>
          <span className="text-xs text-slate-500 tabular-nums">{invoices.length} invoices</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 border-b border-slate-200 text-slate-500">
              <tr>
                <th className="py-2.5 px-4">Invoice #</th>
                <th className="py-2.5 px-4">Student</th>
                <th className="py-2.5 px-4">Period / Due</th>
                <th className="py-2.5 px-4 text-right">Total</th>
                <th className="py-2.5 px-4 text-right">Paid</th>
                <th className="py-2.5 px-4 text-right">Balance</th>
                <th className="py-2.5 px-4">Status</th>
                <th className="py-2.5 px-4 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {invoices.map((inv) => {
                const bal = Math.max(0, inv.total_cents - inv.paid_cents);
                return (
                  <tr key={inv.id} className="hover:bg-slate-50">
                    <td className="py-2.5 px-4 font-mono text-slate-800">{inv.invoice_number}</td>
                    <td className="py-2.5 px-4">
                      <div className="font-medium text-slate-900">{inv.student_name}</div>
                      <div className="font-mono text-slate-500">{inv.student_code}</div>
                    </td>
                    <td className="py-2.5 px-4">
                      <div>{inv.billing_period}</div>
                      <div className="font-mono text-slate-500">Due {inv.due_date}</div>
                    </td>
                    <td className="py-2.5 px-4 text-right font-mono tabular-nums">{formatCurrency(inv.total_cents)}</td>
                    <td className="py-2.5 px-4 text-right font-mono tabular-nums text-emerald-700">
                      {formatCurrency(inv.paid_cents)}
                    </td>
                    <td className="py-2.5 px-4 text-right font-mono tabular-nums font-semibold">
                      {formatCurrency(bal)}
                    </td>
                    <td className="py-2.5 px-4 capitalize font-medium">
                      <span
                        className={
                          inv.status === 'paid'
                            ? 'text-emerald-700'
                            : inv.status === 'overdue'
                            ? 'text-red-700'
                            : 'text-amber-700'
                        }
                      >
                        {inv.status}
                      </span>
                    </td>
                    <td className="py-2.5 px-4 text-right">
                      {bal > 0 && (
                        <button
                          onClick={() => {
                            setPayInvoice(inv);
                            setPayAmount((bal / 100).toFixed(2));
                          }}
                          className="inline-flex items-center gap-1 px-2.5 py-1 bg-slate-900 text-white rounded hover:bg-slate-800"
                        >
                          <CreditCard className="w-3 h-3" />
                          <span>Collect</span>
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Payment Receipts History */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-200">
          <h3 className="text-sm font-semibold text-slate-900">Payment & Receipt Ledger (Immutable)</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 border-b border-slate-200 text-slate-500">
              <tr>
                <th className="py-2.5 px-4">Receipt #</th>
                <th className="py-2.5 px-4">Student</th>
                <th className="py-2.5 px-4">Invoice</th>
                <th className="py-2.5 px-4">Method & Date</th>
                <th className="py-2.5 px-4 text-right">Amount</th>
                <th className="py-2.5 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {payments.map((p) => (
                <tr key={p.id}>
                  <td className="py-2.5 px-4 font-mono text-slate-800">{p.receipt_number}</td>
                  <td className="py-2.5 px-4">{p.student_name} ({p.student_code})</td>
                  <td className="py-2.5 px-4 font-mono">{p.invoice_number}</td>
                  <td className="py-2.5 px-4">
                    {p.method} · <span className="font-mono text-slate-500">{p.payment_date}</span>
                  </td>
                  <td className={`py-2.5 px-4 text-right font-mono tabular-nums ${p.is_reversal ? 'text-red-700' : 'text-emerald-700'}`}>
                    {formatCurrency(p.amount_cents)}
                  </td>
                  <td className="py-2.5 px-4 text-right space-x-2 whitespace-nowrap">
                    <button
                      onClick={() => setReceipt(p)}
                      className="px-2 py-1 border border-slate-200 rounded text-slate-700 hover:bg-slate-50"
                    >
                      Receipt
                    </button>
                    {!p.is_reversal && (
                      <button
                        onClick={() => handleReversePayment(p.id, p.receipt_number)}
                        className="inline-flex items-center gap-1 px-2 py-1 border border-slate-200 rounded text-slate-600 hover:text-red-700"
                      >
                        <RotateCcw className="w-3 h-3" />
                        <span>Reverse</span>
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Collect Payment Modal */}
      {payInvoice && (
        <div className="fixed inset-0 bg-slate-900/50 z-50 flex items-center justify-center p-4">
          <form onSubmit={handleRecordPayment} className="bg-white border border-slate-200 rounded-xl w-full max-w-md p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <h3 className="text-sm font-bold text-slate-900">Record Payment · {payInvoice.invoice_number}</h3>
              <button type="button" onClick={() => setPayInvoice(null)} aria-label="Close Payment Modal" className="text-slate-400">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="text-xs text-slate-600">
              Student: <strong>{payInvoice.student_name}</strong> ({payInvoice.student_code})
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Amount (USD)</label>
              <input
                type="number"
                step="0.01"
                required
                value={payAmount}
                onChange={(e) => setPayAmount(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg font-mono tabular-nums"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Payment Method</label>
              <select
                value={payMethod}
                onChange={(e) => setPayMethod(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
              >
                <option value="Cash">Cash</option>
                <option value="Bank Transfer">Bank Transfer</option>
                <option value="Cheque">Cheque</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Reference / Cheque #</label>
              <input
                type="text"
                value={payRef}
                onChange={(e) => setPayRef(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg font-mono"
              />
            </div>
            <button type="submit" className="w-full py-2 bg-emerald-700 text-white text-xs font-medium rounded-lg">
              Confirm Payment & Issue Receipt
            </button>
          </form>
        </div>
      )}

      {/* Printable Receipt Modal */}
      {receipt && (
        <div className="fixed inset-0 bg-slate-900/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-xl w-full max-w-md p-6 space-y-4">
            <div className="flex items-center justify-between no-print">
              <h3 className="text-sm font-bold text-slate-900">Official Payment Receipt</h3>
              <button onClick={() => setReceipt(null)} aria-label="Close Receipt" className="text-slate-400">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="border border-slate-300 rounded-lg p-5 space-y-2 text-xs">
              <div className="text-sm font-bold text-slate-900">Receipt #{receipt.receipt_number}</div>
              <div className="text-slate-500">Date: {receipt.payment_date}</div>
              <div className="pt-2 border-t border-slate-200 space-y-1">
                <div>Student: <strong>{receipt.student_name}</strong> ({receipt.student_code})</div>
                <div>Invoice: <span className="font-mono">{receipt.invoice_number}</span></div>
                <div>Method: {receipt.method} {receipt.reference_no ? `(${receipt.reference_no})` : ''}</div>
                <div className="text-base font-bold text-slate-900 pt-2 tabular-nums">
                  Amount Paid: {formatCurrency(receipt.amount_cents)}
                </div>
              </div>
            </div>
            <button
              onClick={() => window.print()}
              className="w-full inline-flex items-center justify-center gap-2 py-2 bg-slate-900 text-white text-xs font-medium rounded-lg no-print"
            >
              <Printer className="w-4 h-4" />
              <span>Print Receipt</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
