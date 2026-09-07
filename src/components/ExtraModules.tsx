import { useEffect, useState, type ReactNode } from 'react';
import { ChevronDown, Download, FileText, History, MoreHorizontal, Search, Store, X } from 'lucide-react';
import { loadAuditLogs, loadOrderItems, loadReportData, loadSites } from '@/lib/workspace';
import type { AuditLog, Order, OrderItem, Site } from '@/types';

function formatUsd(value: number) { return `$${value.toLocaleString('en-US', { minimumFractionDigits: 2 })}`; }
function Empty({ text }: { text: string }) { return <div className="p-10 text-center text-sm text-slate-400">{text}</div>; }
function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 backdrop-blur-sm sm:items-center sm:p-4"><div className="scroll-touch flex max-h-[92vh] w-full max-w-lg flex-col overflow-y-auto rounded-t-3xl bg-white p-5 shadow-2xl sm:rounded-3xl sm:p-6"><div className="mb-6 flex items-center justify-between"><h3 className="font-display text-lg font-bold text-slate-900">{title}</h3><button onClick={onClose} className="icon-button"><X size={19} /></button></div>{children}</div></div>;
}

// ===================== Site Selector =====================

export function SiteSelector({ siteId, onChange }: { siteId: string | null; onChange: (id: string) => void }) {
  const [sites, setSites] = useState<Site[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => { loadSites().then(setSites).catch(() => {}); }, []);
  const current = sites.find(s => s.id === siteId) ?? sites[0];

  return <div className="relative">
    <button onClick={() => setOpen(!open)} className="flex items-center gap-2 rounded-xl bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-600 transition hover:bg-slate-100">
      <span className="h-2 w-2 rounded-full bg-emerald-500" />
      {current ? current.name : 'Tous les sites'}
      <ChevronDown size={14} />
    </button>
    {open && <div className="absolute right-0 top-12 z-30 w-56 rounded-xl border border-slate-200 bg-white p-1.5 shadow-xl">
      <button onClick={() => { onChange('all'); setOpen(false); }} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50"><Store size={15} /> Tous les sites</button>
      {sites.map(s => <button key={s.id} onClick={() => { onChange(s.id); setOpen(false); }} className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold hover:bg-slate-50 ${siteId === s.id ? 'bg-cyan-50 text-cyan-800' : 'text-slate-600'}`}><Store size={15} /> {s.name}</button>)}
    </div>}
  </div>;
}

// ===================== Receipt PDF =====================

export function ReceiptModal({ order, onClose }: { order: Order; onClose: () => void }) {
  const [items, setItems] = useState<OrderItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => { loadOrderItems(order.id).then(data => { setItems(data); setLoading(false); }).catch(() => setLoading(false)); }, [order.id]);

  function downloadReceipt() {
    const win = window.open('', '_blank');
    if (!win) return;
    const itemsHtml = items.map(item => `<tr><td style="padding:6px 0">${item.service_name}</td><td style="text-align:center">${item.quantity}</td><td style="text-align:right">${formatUsd(Number(item.unit_price_usd))}</td><td style="text-align:right">${formatUsd(Number(item.unit_price_usd) * item.quantity)}</td></tr>`).join('');
    win.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Reçu ${order.order_number}</title><style>body{font-family:'DM Sans',sans-serif;max-width:420px;margin:40px auto;padding:0 24px;color:#152238}h1{font-size:22px;margin:0}.muted{color:#708096;font-size:13px}table{width:100%;border-collapse:collapse;margin:20px 0;font-size:14px}th{text-align:left;font-size:11px;text-transform:uppercase;color:#94a3b8;border-bottom:1px solid #e2e8f0;padding-bottom:6px}.total{border-top:2px solid #152238;margin-top:8px;padding-top:10px;font-size:18px;font-weight:bold}.row{display:flex;justify-content:space-between;margin:4px 0;font-size:14px}</style></head><body>
      <h1>AquaFlow Car Wash</h1>
      <p class="muted">Avenue Kasaï, Lubumbashi, RDC · +243 81 000 0000</p>
      <hr style="border:none;border-top:2px dashed #cbd5e1;margin:16px 0">
      <div class="row"><span class="muted">Reçu</span><span style="font-weight:bold">${order.order_number}</span></div>
      <div class="row"><span class="muted">Date</span><span>${new Date(order.created_at).toLocaleString('fr-FR')}</span></div>
      <div class="row"><span class="muted">Client</span><span>${order.customer_name}</span></div>
      <div class="row"><span class="muted">Véhicule</span><span>${order.vehicle_label}</span></div>
      <table><thead><tr><th>Service</th><th style="text-align:center">Qté</th><th style="text-align:right">P.U.</th><th style="text-align:right">Total</th></tr></thead><tbody>${itemsHtml}</tbody></table>
      <div class="row total"><span>Total</span><span>${formatUsd(order.total_usd)}</span></div>
      <div class="row"><span class="muted">Paiement</span><span>${order.payment_method}</span></div>
      <hr style="border:none;border-top:2px dashed #cbd5e1;margin:16px 0">
      <p style="text-align:center" class="muted">Merci de votre confiance !</p>
    </body></html>`);
    win.document.close();
    setTimeout(() => win.print(), 300);
  }

  return <Modal title={`Reçu ${order.order_number}`} onClose={onClose}>
    <div className="space-y-4">
      <div className="rounded-xl bg-slate-50 p-4 space-y-2">
        <div className="flex justify-between text-sm"><span className="text-slate-500">Client</span><span className="font-semibold text-slate-800">{order.customer_name}</span></div>
        <div className="flex justify-between text-sm"><span className="text-slate-500">Véhicule</span><span className="font-semibold text-slate-800">{order.vehicle_label}</span></div>
        <div className="flex justify-between text-sm"><span className="text-slate-500">Date</span><span className="font-semibold text-slate-800">{new Date(order.created_at).toLocaleString('fr-FR')}</span></div>
        <div className="flex justify-between text-sm"><span className="text-slate-500">Paiement</span><span className="font-semibold text-slate-800">{order.payment_method}</span></div>
      </div>
      {loading ? <Empty text="Chargement des articles…" /> : items.length === 0 ? <Empty text="Aucun article détaillé." /> : (
        <div className="rounded-xl border border-slate-200 p-4">
        <div className="table-scroll"><table className="w-full text-left text-sm"><thead><tr className="border-b border-slate-100 text-[10px] uppercase text-slate-400"><th className="pb-2">Service</th><th className="pb-2 text-center">Qté</th><th className="pb-2 text-right">P.U.</th><th className="pb-2 text-right">Total</th></tr></thead>
          <tbody>{items.map(item => <tr key={item.id} className="border-b border-slate-50 last:border-0"><td className="py-2 font-semibold text-slate-700">{item.service_name}</td><td className="py-2 text-center text-slate-500">{item.quantity}</td><td className="py-2 text-right text-slate-600">{formatUsd(Number(item.unit_price_usd))}</td><td className="py-2 text-right font-bold text-slate-800">{formatUsd(Number(item.unit_price_usd) * item.quantity)}</td></tr>)}</tbody>
          </table></div>
          <div className="mt-3 flex justify-between border-t border-slate-200 pt-3 text-base font-bold"><span>Total</span><span className="font-display text-cyan-800">{formatUsd(order.total_usd)}</span></div>
        </div>
      )}
      <button onClick={downloadReceipt} className="primary-button h-11 w-full"><Download size={17} /> Télécharger / Imprimer le reçu</button>
    </div>
  </Modal>;
}

// ===================== Audit Log Page =====================

export function AuditPage() {
  const [items, setItems] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');

  async function refresh() {
    setLoading(true); setError('');
    try { setItems(await loadAuditLogs(150)); } catch { setError('Impossible de charger le journal.'); } finally { setLoading(false); }
  }
  useEffect(() => { refresh(); }, []);

  const filtered = items.filter(log => `${log.action} ${log.entity_type}`.toLowerCase().includes(search.toLowerCase()));

  function actionTone(action: string) {
    if (action.includes('create')) return 'bg-emerald-50 text-emerald-700';
    if (action.includes('update')) return 'bg-cyan-50 text-cyan-700';
    if (action.includes('delete')) return 'bg-rose-50 text-rose-700';
    return 'bg-slate-100 text-slate-600';
  }

  return <div className="space-y-6">
    <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
      <div><h2 className="font-display text-2xl font-bold text-slate-900">Journal d’audit</h2><p className="mt-1 text-sm text-slate-500">Traçabilité de toutes les actions effectuées dans l’application.</p></div>
    </div>
    {error && <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>}
    <div className="card overflow-hidden">
      <div className="border-b border-slate-100 p-4"><div className="relative max-w-sm"><Search className="absolute left-3 top-3 text-slate-400" size={17} /><input className="input pl-10" placeholder="Rechercher une action…" value={search} onChange={e => setSearch(e.target.value)} /></div></div>
      {loading ? <Empty text="Chargement du journal…" /> : filtered.length === 0 ? <Empty text="Aucune action enregistrée." /> : (
        <div className="divide-y divide-slate-50">{filtered.map(log => <div key={log.id} className="flex items-center gap-3 p-4">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-100 text-slate-500"><History size={16} /></div>
          <div className="flex-1"><div className="flex items-center gap-2"><span className={`badge ${actionTone(log.action)}`}>{log.action}</span><span className="text-xs text-slate-400">{log.entity_type}</span></div><div className="mt-1 text-xs text-slate-400">{new Date(log.created_at).toLocaleString('fr-FR')}</div></div>
          <button className="icon-button"><MoreHorizontal size={17} /></button>
        </div>)}</div>
      )}
    </div>
  </div>;
}

// ===================== Connected Reports Page =====================

export function ConnectedReportsPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [revenue, setRevenue] = useState(0);
  const [expenses, setExpenses] = useState(0);
  const [topServices, setTopServices] = useState<{ name: string; count: number; revenue: number }[]>([]);
  const [paymentBreakdown, setPaymentBreakdown] = useState<{ method: string; count: number; amount: number }[]>([]);
  const [period, setPeriod] = useState<'week' | 'month' | 'year' | 'custom'>('month');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');

  function getRange(): { start: Date; end: Date } {
    const end = new Date(); end.setHours(23, 59, 59, 999);
    const start = new Date(); start.setHours(0, 0, 0, 0);
    if (period === 'week') { start.setDate(start.getDate() - 7); }
    else if (period === 'month') { start.setMonth(start.getMonth() - 1); }
    else if (period === 'year') { start.setFullYear(start.getFullYear() - 1); }
    else if (period === 'custom') {
      if (customStart) start.setTime(new Date(customStart).getTime());
      if (customEnd) end.setTime(new Date(customEnd).getTime() + 86400000 - 1);
    }
    return { start, end };
  }

  useEffect(() => {
    setLoading(true); setError('');
    loadReportData().then(data => {
      const { start, end } = getRange();
      const inRange = (d: string) => { const dt = new Date(d); return dt >= start && dt <= end; };
      const validOrders = data.orders.filter((o: { status: string; created_at: string }) => !['cancelled', 'refunded'].includes(o.status) && inRange(o.created_at));
      const validExpenses = data.expenses.filter((e: { status: string; created_at: string }) => e.status === 'approved' && inRange(e.created_at));
      const validItems = (data.items as { service_name: string; quantity: number; unit_price_usd: number; order_id: string }[]).filter((item) => {
        const order = data.orders.find((o: { id: string }) => o.id === item.order_id);
        return order && inRange(order.created_at);
      });
      setRevenue(validOrders.reduce((s: number, o: { total_usd: number }) => s + Number(o.total_usd), 0));
      setExpenses(validExpenses.reduce((s: number, e: { amount: number }) => s + Number(e.amount), 0));
      const svcMap = new Map<string, { count: number; revenue: number }>();
      for (const item of validItems) {
        const key = item.service_name;
        const existing = svcMap.get(key) ?? { count: 0, revenue: 0 };
        existing.count += Number(item.quantity);
        existing.revenue += Number(item.unit_price_usd) * Number(item.quantity);
        svcMap.set(key, existing);
      }
      setTopServices(Array.from(svcMap.entries()).map(([name, v]) => ({ name, ...v })).sort((a, b) => b.revenue - a.revenue).slice(0, 6));
      const payMap = new Map<string, { count: number; amount: number }>();
      for (const o of validOrders as { payment_method: string; total_usd: number }[]) {
        const key = o.payment_method || 'Autre';
        const existing = payMap.get(key) ?? { count: 0, amount: 0 };
        existing.count += 1;
        existing.amount += Number(o.total_usd);
        payMap.set(key, existing);
      }
      setPaymentBreakdown(Array.from(payMap.entries()).map(([method, v]) => ({ method, ...v })).sort((a, b) => b.amount - a.amount));
    }).catch(() => setError('Impossible de charger les rapports.')).finally(() => setLoading(false));
  }, [period, customStart, customEnd]);

  function exportCsv() {
    const rows = [['Service', 'Ventes', 'Revenu USD']];
    topServices.forEach(s => rows.push([s.name, String(s.count), s.revenue.toFixed(2)]));
    const csv = rows.map(r => r.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'rapport-services.csv'; a.click();
    URL.revokeObjectURL(url);
  }

  if (loading) return <div className="flex items-center justify-center py-20"><div className="h-5 w-5 animate-spin rounded-full border-2 border-cyan-700 border-t-transparent" /></div>;
  if (error) return <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>;

  const profit = revenue - expenses;
  const maxRevenue = Math.max(...topServices.map(s => s.revenue), 1);
  const periodLabel = period === 'week' ? '7 derniers jours' : period === 'month' ? '30 derniers jours' : period === 'year' ? '12 derniers mois' : 'Période personnalisée';

  return <div className="space-y-6">
    <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
      <div><h2 className="font-display text-2xl font-bold text-slate-900">Rapports</h2><p className="mt-1 text-sm text-slate-500">Analysez les performances commerciales et opérationnelles.</p></div>
      <button onClick={exportCsv} className="primary-button"><Download size={17} /> Exporter en CSV</button>
    </div>
    <div className="card p-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold uppercase tracking-[.08em] text-slate-400">Période</span>
          <div className="flex gap-1 rounded-xl bg-slate-100 p-1">
            {([['week','Hebdo'],['month','Mensuel'],['year','Annuel'],['custom','Perso']] as const).map(([val, label]) => (
              <button key={val} onClick={() => setPeriod(val)} className={`rounded-lg px-3 py-1.5 text-xs font-bold transition ${period === val ? 'bg-white text-cyan-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>{label}</button>
            ))}
          </div>
        </div>
        {period === 'custom' && (
          <div className="flex items-center gap-2">
            <input type="date" className="input" value={customStart} onChange={e => setCustomStart(e.target.value)} />
            <span className="text-sm text-slate-400">→</span>
            <input type="date" className="input" value={customEnd} onChange={e => setCustomEnd(e.target.value)} />
          </div>
        )}
        <span className="ml-auto text-xs font-semibold text-slate-400">{periodLabel}</span>
      </div>
    </div>
    <div className="grid gap-4 sm:grid-cols-3">
      <div className="card p-5"><div className="text-[13px] font-semibold text-slate-500">Chiffre d’affaires</div><div className="mt-1 font-display text-[26px] font-bold text-slate-900">{formatUsd(revenue)}</div></div>
      <div className="card p-5"><div className="text-[13px] font-semibold text-slate-500">Dépenses validées</div><div className="mt-1 font-display text-[26px] font-bold text-rose-600">{formatUsd(expenses)}</div></div>
      <div className="card p-5"><div className="text-[13px] font-semibold text-slate-500">Bénéfice estimatif</div><div className="mt-1 font-display text-[26px] font-bold text-emerald-600">{formatUsd(profit)}</div></div>
    </div>
    <div className="grid gap-6 xl:grid-cols-2">
      <div className="card p-5"><div className="flex items-center justify-between"><div><h3 className="font-display font-bold text-slate-900">Services les plus vendus</h3><p className="mt-1 text-xs text-slate-400">Revenu par service</p></div><FileText size={18} className="text-slate-400" /></div>
        <div className="mt-6 space-y-5">{topServices.length === 0 ? <Empty text="Aucune vente sur cette période." /> : topServices.map(s => <div key={s.name}><div className="mb-2 flex items-center justify-between"><div><span className="text-sm font-bold text-slate-700">{s.name}</span><span className="ml-2 text-xs text-slate-400">{s.count} ventes</span></div><span className="text-sm font-bold text-slate-800">{formatUsd(s.revenue)}</span></div><div className="h-2.5 rounded-full bg-slate-100"><div className="h-full rounded-full bg-cyan-600" style={{ width: `${Math.round(s.revenue / maxRevenue * 100)}%` }} /></div></div>)}</div>
      </div>
      <div className="card p-5"><div className="flex items-center justify-between"><div><h3 className="font-display font-bold text-slate-900">Répartition des paiements</h3><p className="mt-1 text-xs text-slate-400">Par moyen de paiement</p></div></div>
        <div className="mt-6 space-y-5">{paymentBreakdown.length === 0 ? <Empty text="Aucun paiement sur cette période." /> : paymentBreakdown.map(p => <div key={p.method}><div className="mb-2 flex items-center justify-between"><div><span className="text-sm font-bold text-slate-700">{p.method}</span><span className="ml-2 text-xs text-slate-400">{p.count} transactions</span></div><span className="text-sm font-bold text-slate-800">{formatUsd(p.amount)}</span></div><div className="h-2.5 rounded-full bg-slate-100"><div className="h-full rounded-full bg-emerald-600" style={{ width: `${Math.round(p.amount / (revenue || 1) * 100)}%` }} /></div></div>)}</div>
      </div>
    </div>
  </div>;
}
