import { useEffect, useState, type ReactNode } from 'react';
import { ChevronDown, Download, FileText, History, MoreHorizontal, Search, Store, X, CalendarDays } from 'lucide-react';
import { loadAuditLogs, loadOrderItems, loadReportData, loadSites, loadProfileName, loadCurrentProfileName, loadSettings } from '@/lib/workspace';
import type { AuditLog, Order, OrderItem, Site } from '@/types';
import { printP5_30D8 } from '@/lib/printing/thermalPrinter';

function formatUsd(value: number) { return `$${value.toLocaleString('en-US', { minimumFractionDigits: 2 })}`; }
function encodeThermalTicket(order: Order, company: Site | null, items: OrderItem[] = [], cashier: string | null = null): Uint8Array {
  const width = 32;
  const line = '-'.repeat(width);
  const money = (value: number, currency = 'USD') => `${Number(value || 0).toFixed(2).replace(/\.00$/, '').replace(/\B(?=(\d{3})+(?!\d))/g, ',')} ${currency}`;
  const wrap = (value: unknown, max = width) => {
    const text = String(value ?? '-').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\x20-\x7E\n]/g, '?');
    const result: string[] = [];
    for (let i = 0; i < text.length; i += max) result.push(text.slice(i, i + max));
    return result.length ? result : ['—'];
  };
  const rows = (label: string, value: unknown) => wrap(`${label}: ${value}`).join('\n');
  const rate = Number(order.exchange_rate || 2850);
  const paymentCurrency = order.payment_currency || 'USD';
  const tendered = Number(order.amount_tendered ?? order.payment_amount ?? 0);
  const change = Number(order.change_amount || 0);
  const toBoth = (amount: number, currency: string) => currency === 'CDF'
    ? `${money(amount, 'CDF')} / ${money(amount / rate, 'USD')}`
    : `${money(amount, 'USD')} / ${money(amount * rate, 'CDF')}`;
  const itemLines = items.length
    ? items.flatMap(item => {
        const unitUsd = Number(item.unit_price_usd || 0);
        const totalUsd = unitUsd * Number(item.quantity || 0);
        return [
          ...wrap(item.service_name),
          `${item.quantity} x ${money(unitUsd, 'USD')} / ${money(unitUsd * rate, 'CDF')}`,
          `Total: ${money(totalUsd, 'USD')} / ${money(totalUsd * rate, 'CDF')}`,
        ];
      })
    : ['Aucun article détaillé'];
  const text = [
    '\x1B@', '\x1B\x61\x01', '\x1B\x45\x01', ...wrap(company?.name || 'AquaFlow Car Wash'), '\x1B\x45\x00',
    ...wrap([company?.address, company?.phone].filter(Boolean).join(' | ')),
    '\x1B\x61\x00', line,
    rows('Reçu', order.order_number),
    rows('Date', new Date(order.created_at).toLocaleString('fr-FR')),
    rows('Client', order.customer_name),
    rows('Véhicule', order.vehicle_label),
    line, 'SERVICE / QTE', 'P.U. USD / P.U. CDF', 'TOTAL USD / TOTAL CDF', ...itemLines, line,
    rows('Sous-total', money(Number(order.subtotal_usd ?? order.total_usd), 'USD')),
    rows('Réduction', money(Number(order.discount_amount_usd ?? 0), 'USD')),
    '\x1B\x45\x01', rows('TOTAL', money(Number(order.total_usd), 'USD')), '\x1B\x45\x00',
    rows('Payé', toBoth(Number(order.payment_amount || 0), paymentCurrency)),
    rows('Donné', toBoth(tendered, paymentCurrency)),
    rows('Rendu', toBoth(change, order.change_currency || paymentCurrency)),
    rows('Taux', `1 USD = ${rate.toLocaleString('fr-FR')} CDF`),
    rows('Paiement', order.payment_method),
    rows('Facturier', cashier || '—'),
    line, '\x1B\x61\x01', 'Merci de votre confiance !', '', '\x1B\x64\x03',
  ].join('\n');
  // Use conservative ASCII for maximum compatibility with small Bluetooth ESC/POS printers.
  const bytes: number[] = [];
  for (const char of text) {
    if (char === '\n') { bytes.push(0x0a); continue; }
    const code = char.charCodeAt(0);
    bytes.push(code <= 0x7e ? code : 0x3f);
  }
  return new Uint8Array(bytes);
}
function humanizeAuditDetails(details: Record<string, unknown>) {
  const source = (details && typeof details === 'object' ? details : {}) as Record<string, unknown>;
  const data = (source.new && typeof source.new === 'object' ? source.new : source) as Record<string, unknown>;
  const payload = (data.payload && typeof data.payload === 'object' ? data.payload : data) as Record<string, unknown>;
  const labels: Record<string, string> = { operation_type: 'Opération', category: 'Catégorie', description: 'Description', amount: 'Montant', currency: 'Devise', status: 'Statut', user_id: 'Utilisateur', site_id: 'Site', operation_id: 'Référence', created_at: 'Créée le', completed_at: 'Terminée le' };
  const entries = Object.entries(payload).filter(([key, value]) => value !== null && value !== undefined && value !== '');
  return entries.map(([key, value]) => `${labels[key] || key.replaceAll('_', ' ')} : ${typeof value === 'object' ? JSON.stringify(value) : String(value)}`).join('\n');
}
function formatAuditAction(action: string) {
  const map: Record<string, string> = { create: 'Création', update: 'Modification', delete: 'Suppression', insert: 'Ajout', approve: 'Validation', reject: 'Rejet', DEPENSE: 'Dépense' };
  return map[action] || action.replaceAll('_', ' ');
}
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
      
      {sites.map(s => <button key={s.id} onClick={() => { onChange(s.id); setOpen(false); }} className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold hover:bg-slate-50 ${siteId === s.id ? 'bg-cyan-50 text-cyan-800' : 'text-slate-600'}`}><Store size={15} /> {s.name}</button>)}
    </div>}
  </div>;
}

// ===================== Receipt PDF =====================

export function ReceiptModal({ order, onClose }: { order: Order; onClose: () => void }) {
  const [items, setItems] = useState<OrderItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [company, setCompany] = useState<Site | null>(null); const [cashier, setCashier] = useState<string | null>(null); const [effectiveRate, setEffectiveRate] = useState<number>(Number(order.exchange_rate) || 2850);

  useEffect(() => { Promise.all([loadOrderItems(order.id), loadSites(), loadSettings().catch(() => ({})), order.created_by ? loadProfileName(order.created_by) : loadCurrentProfileName()]).then(([data,sites,settings,name])=>{ const configured = Number((settings as Record<string,string>).usd_to_cdf_rate || (settings as Record<string,string>).exchange_rate || 0); setEffectiveRate(configured > 0 ? configured : (Number(order.exchange_rate) || 2850)); setItems(data); setCompany(sites[0]??null); setCashier(name); setLoading(false); }).catch(()=>setLoading(false)); }, [order.id]);

  function downloadReceipt() {
    const win = window.open('', '_blank');
    if (!win) return;
    const rate = effectiveRate; const itemsHtml = items.map(item => { const unitUsd = Number(item.unit_price_usd || 0); const totalUsd = unitUsd * Number(item.quantity || 0); return `<tr><td style="padding:6px 0">${item.service_name}</td><td style="text-align:center">${item.quantity}</td><td style="text-align:right">${formatUsd(unitUsd)}</td><td style="text-align:right">${Math.round(unitUsd * rate).toLocaleString('fr-FR')} CDF</td><td style="text-align:right">${formatUsd(totalUsd)}</td><td style="text-align:right">${Math.round(totalUsd * rate).toLocaleString('fr-FR')} CDF</td></tr>`; }).join('');
    win.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Reçu ${order.order_number}</title><style>body{font-family:'DM Sans',sans-serif;max-width:420px;margin:40px auto;padding:0 24px;color:#152238}h1{font-size:22px;margin:0}.muted{color:#708096;font-size:13px}table{width:100%;border-collapse:collapse;margin:20px 0;font-size:11px} @media print{body{margin:0;max-width:none;padding:8px}table{font-size:10px}}th{text-align:left;font-size:11px;text-transform:uppercase;color:#94a3b8;border-bottom:1px solid #e2e8f0;padding-bottom:6px}.total{border-top:2px solid #152238;margin-top:8px;padding-top:10px;font-size:18px;font-weight:bold}.row{display:flex;justify-content:space-between;margin:4px 0;font-size:14px}</style></head><body>
      <h1>${company?.name || 'AquaFlow Car Wash'}</h1>
      <p class="muted">${company?.address || ''}${company?.phone ? ` · ${company.phone}` : ''}</p>
      <hr style="border:none;border-top:2px dashed #cbd5e1;margin:16px 0">
      <div class="row"><span class="muted">Reçu</span><span style="font-weight:bold">${order.order_number}</span></div>
      <div class="row"><span class="muted">Date</span><span>${new Date(order.created_at).toLocaleString('fr-FR')}</span></div>
      <div class="row"><span class="muted">Client</span><span>${order.customer_name}</span></div>
      <div class="row"><span class="muted">Véhicule</span><span>${order.vehicle_label}</span></div>
      <table><thead><tr><th>Service</th><th style="text-align:center">Qté</th><th style="text-align:right">P.U. USD</th><th style="text-align:right">P.U. CDF</th><th style="text-align:right">Total USD</th><th style="text-align:right">Total CDF</th></tr></thead><tbody>${itemsHtml}</tbody></table>
      <div class="row"><span class="muted">Sous-total</span><span>${formatUsd(Number(order.subtotal_usd ?? order.total_usd))}</span></div><div class="row"><span class="muted">Réduction</span><span>−${formatUsd(Number(order.discount_amount_usd ?? 0))}</span></div><div class="row total"><span>Total</span><span>${formatUsd(order.total_usd)}</span></div><div class="row"><span class="muted">Montant payé</span><span>${Number(order.payment_amount||0).toLocaleString('fr-FR',{maximumFractionDigits:2})} ${order.payment_currency||'USD'} = ${order.payment_currency==='CDF' ? formatUsd(Number(order.payment_amount||0)/Number(order.exchange_rate||2850)) : `${Math.round(Number(order.payment_amount||0)*Number(order.exchange_rate||2850)).toLocaleString('fr-FR')} CDF`}</span></div><div class="row"><span class="muted">Montant donné</span><span>${Number(order.amount_tendered ?? order.payment_amount ?? 0).toLocaleString('fr-FR',{maximumFractionDigits:2})} ${order.payment_currency||'USD'} = ${order.payment_currency==='CDF' ? formatUsd(Number(order.amount_tendered ?? order.payment_amount ?? 0)/Number(order.exchange_rate||2850)) : `${Math.round(Number(order.amount_tendered ?? order.payment_amount ?? 0)*Number(order.exchange_rate||2850)).toLocaleString('fr-FR')} CDF`}</span></div><div class="row"><span class="muted">Monnaie rendue</span><span>${Number(order.change_amount||0).toLocaleString('fr-FR',{maximumFractionDigits:2})} ${order.change_currency||order.payment_currency||'USD'} = ${order.change_currency==='CDF' ? formatUsd(Number(order.change_amount||0)/Number(order.exchange_rate||2850)) : `${Math.round(Number(order.change_amount||0)*Number(order.exchange_rate||2850)).toLocaleString('fr-FR')} CDF`}</span></div><div class="row"><span class="muted">Taux appliqué</span><span>1 USD = ${Number(order.exchange_rate||2850).toLocaleString('fr-FR')} CDF</span></div><div class="row"><span class="muted">Paiement</span><span>${order.payment_method}</span></div><div class="row"><span class="muted">Facturier</span><span>${cashier||'—'}</span></div>
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
        <div className="flex justify-between text-sm"><span className="text-slate-500">Paiement</span><span className="font-semibold text-slate-800">{order.payment_method}</span></div><div className="flex justify-between text-sm"><span className="text-slate-500">Montant payé</span><span className="font-semibold text-slate-800">{Number(order.payment_amount||0).toLocaleString('fr-FR')} {order.payment_currency||'USD'}</span></div><div className="flex justify-between text-sm"><span className="text-slate-500">Donné / rendu</span><span className="font-semibold text-slate-800">{Number(order.amount_tendered||0).toLocaleString('fr-FR')} / {Number(order.change_amount||0).toLocaleString('fr-FR')} {order.change_currency||order.payment_currency||'USD'}</span></div><div className="flex justify-between text-sm"><span className="text-slate-500">Facturier</span><span className="font-semibold text-slate-800">{cashier||'—'}</span></div>
      </div>
      {loading ? <Empty text="Chargement des articles…" /> : items.length === 0 ? <Empty text="Aucun article détaillé." /> : (
        <div className="rounded-xl border border-slate-200 p-4">
        <div className="table-scroll"><table className="w-full text-left text-sm"><thead><tr className="border-b border-slate-100 text-[10px] uppercase text-slate-400"><th className="pb-2">Service</th><th className="pb-2 text-center">Qté</th><th className="pb-2 text-right">P.U. USD</th><th className="pb-2 text-right">P.U. CDF</th><th className="pb-2 text-right">Total USD</th><th className="pb-2 text-right">Total CDF</th></tr></thead>
          <tbody>{items.map(item => <tr key={item.id} className="border-b border-slate-50 last:border-0"><td className="py-2 font-semibold text-slate-700">{item.service_name}</td><td className="py-2 text-center text-slate-500">{item.quantity}</td><td className="py-2 text-right text-slate-600">{formatUsd(Number(item.unit_price_usd))}</td><td className="py-2 text-right text-slate-600">{Math.round(Number(item.unit_price_usd) * effectiveRate).toLocaleString('fr-FR')} CDF</td><td className="py-2 text-right font-bold text-slate-800">{formatUsd(Number(item.unit_price_usd) * item.quantity)}</td><td className="py-2 text-right font-bold text-slate-800">{Math.round(Number(item.unit_price_usd) * item.quantity * effectiveRate).toLocaleString('fr-FR')} CDF</td></tr>)}</tbody>
          </table></div>
          <div className="mt-3 flex justify-between border-t border-slate-200 pt-3 text-base font-bold"><span>Total</span><span className="font-display text-cyan-800">{formatUsd(order.total_usd)}</span></div>
        </div>
      )}
      <button onClick={downloadReceipt} className="primary-button h-11 w-full"><Download size={17} /> Télécharger / Imprimer le reçu</button>
      <button onClick={() => printP5_30D8(encodeThermalTicket({ ...order, exchange_rate: effectiveRate }, company, items, cashier)).catch(error => window.alert(error instanceof Error ? error.message : 'Impression Bluetooth impossible.'))} className="secondary-button h-11 w-full">Imprimer sur P5_30D8 (Bluetooth)</button>
    </div>
  </Modal>;
}

// ===================== Audit Log Page =====================

export function AuditPage() {
  const [items, setItems] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [selectedLog, setSelectedLog] = useState<AuditLog | null>(null);

  async function refresh() {
    setLoading(true); setError('');
    try { setItems(await loadAuditLogs(150, startDate || undefined, endDate ? new Date(new Date(endDate).getTime() + 86400000).toISOString().slice(0,10) : undefined)); } catch { setError('Impossible de charger le journal.'); } finally { setLoading(false); }
  }
  useEffect(() => { refresh(); }, [startDate, endDate]);
  function preset(kind: 'yesterday'|'today'|'week'|'month') { const d = new Date(); if (kind === 'yesterday') d.setDate(d.getDate()-1); if (kind === 'week') d.setDate(d.getDate()-6); if (kind === 'month') d.setDate(d.getDate()-29); const end = new Date(); if (kind === 'yesterday') end.setDate(end.getDate()-1); setStartDate(d.toISOString().slice(0,10)); setEndDate(end.toISOString().slice(0,10)); }

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
      <div className="border-b border-slate-100 p-4"><div className="mb-3 flex flex-wrap gap-2">{([ ['today','Aujourd’hui'],['yesterday','Hier'],['week','Hebdomadaire'],['month','Mensuel'] ] as const).map(([k,l]) => <button key={k} onClick={() => preset(k)} className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50"><CalendarDays size={13} className="mr-1 inline" />{l}</button>)}<button onClick={() => { setStartDate(''); setEndDate(''); }} className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600">Toutes les dates</button></div><div className="grid gap-3 sm:grid-cols-[1fr_auto_auto]"><div className="relative"><Search className="absolute left-3 top-3 text-slate-400" size={17} /><input className="input pl-10" placeholder="Rechercher une action…" value={search} onChange={e => setSearch(e.target.value)} /></div><input type="date" className="input" value={startDate} onChange={e => setStartDate(e.target.value)} aria-label="Date de début" /><input type="date" className="input" value={endDate} onChange={e => setEndDate(e.target.value)} aria-label="Date de fin" /></div></div>
      {loading ? <Empty text="Chargement du journal…" /> : filtered.length === 0 ? <Empty text="Aucune action enregistrée." /> : (
        <div className="divide-y divide-slate-50">{filtered.map(log => <button type="button" key={log.id} onClick={() => setSelectedLog(log)} className="flex w-full items-center gap-3 p-4 text-left hover:bg-slate-50">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-100 text-slate-500"><History size={16} /></div>
          <div className="flex-1"><div className="flex items-center gap-2"><span className={`badge ${actionTone(log.action)}`}>{log.action}</span><span className="text-xs text-slate-400">{log.entity_type}</span></div><div className="mt-1 text-xs text-slate-400">{new Date(log.created_at).toLocaleString('fr-FR')} · <span className="font-semibold text-slate-500">{log.actor_name || log.actor_id || 'Utilisateur système'}</span></div></div>
          <span className="icon-button"><MoreHorizontal size={17} /></span>
        </button>)}</div>
      )}
    </div>
    {selectedLog && <Modal title="Détails de l’opération" onClose={() => setSelectedLog(null)}><div className="space-y-3 text-sm"><div className="rounded-xl border border-cyan-100 bg-cyan-50 p-4"><div className="text-xs font-bold uppercase tracking-wide text-cyan-700">Résumé</div><p className="mt-2 whitespace-pre-line leading-6 text-cyan-950">{`L’utilisateur ${selectedLog.actor_name || selectedLog.actor_id || 'Système'} a effectué l’action « ${formatAuditAction(selectedLog.action)} » dans le module « ${selectedLog.entity_type} ».`}</p></div><div className="grid gap-3 sm:grid-cols-2">{Object.entries({ Utilisateur: selectedLog.actor_name || selectedLog.actor_id || 'Système', 'Date et heure': new Date(selectedLog.created_at).toLocaleString('fr-FR'), Module: selectedLog.entity_type, Référence: selectedLog.entity_id || '—' }).map(([k,v]) => <div key={k} className="rounded-xl bg-slate-50 p-3"><div className="text-xs font-semibold uppercase text-slate-400">{k}</div><div className="mt-1 break-words font-medium text-slate-700">{v}</div></div>)}</div><div className="rounded-xl bg-slate-50 p-4"><div className="text-xs font-semibold uppercase text-slate-400">Description de l’opération</div><div className="mt-2 whitespace-pre-line break-words leading-6 text-slate-700">{humanizeAuditDetails(selectedLog.details) || 'Aucun détail supplémentaire disponible.'}</div></div></div></Modal>}
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
  const [customEnd, setCustomEnd] = useState(''); const [rawOrders,setRawOrders]=useState<any[]>([]);

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
      setRawOrders(data.orders); const { start, end } = getRange();
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
    const headers=['Date','Commande','Statut','Paiement','Sous-total USD','Réduction USD','Total USD'];
    const rows=rawOrders.filter(o=>!['cancelled','refunded'].includes(o.status)).map(o=>[new Date(o.created_at).toISOString(),o.order_number||'',o.status||'',o.payment_method||'',Number(o.subtotal_usd??o.total_usd??0).toFixed(2),Number(o.discount_amount_usd??0).toFixed(2),Number(o.total_usd??0).toFixed(2)]);
    const esc=(v:unknown)=>`"${String(v??'').replace(/"/g,'""')}"`;
    const csv=[headers,...rows].map(r=>r.map(esc).join(';')).join('\r\n');
    const blob=new Blob(['\ufeff',csv],{type:'text/csv;charset=utf-8;'}); const url=URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url; a.download=`rapport-aquaflow-${new Date().toISOString().slice(0,10)}.csv`; document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(url),0);
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
