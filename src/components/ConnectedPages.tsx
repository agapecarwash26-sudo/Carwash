import { useEffect, useState, type ReactNode } from 'react';
import {
  ArrowDownLeft, ArrowUpRight, BarChart3, Check, CircleDollarSign, Clock3, MoreHorizontal, Package,
  Plus, Search, ShoppingCart, WalletCards, X,
} from 'lucide-react';
import {
  closeCashRegister, createCustomer, createCustomerWithVehicle, createEmployee, createExpense, createProduct,
  loadCashRegister, loadCustomers, loadEmployees, loadExpenses, loadProducts, openCashRegister,
  recordStockMovement, updateExpenseStatus,
} from '@/lib/workspace';
import type { CashMovement, CashRegister, Customer, Employee, Expense, Product } from '@/types';

function formatUsd(value: number) { return `$${value.toLocaleString('en-US', { minimumFractionDigits: 2 })}`; }

function PageShell({ title, subtitle, action, onAction, children }: { title: string; subtitle: string; action?: string; onAction?: () => void; children: ReactNode }) {
  return <div className="space-y-6"><div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end"><div><h2 className="font-display text-2xl font-bold text-slate-900">{title}</h2><p className="mt-1 text-sm text-slate-500">{subtitle}</p></div>{action && <button onClick={onAction} className="primary-button"><Plus size={17} /> {action}</button>}</div>{children}</div>;
}
function MiniStat({ label, value, trend }: { label: string; value: string; trend?: string }) {
  return <div className="card p-4"><div className="text-xs font-semibold text-slate-400">{label}</div><div className="mt-2 flex items-end justify-between"><div className="font-display text-2xl font-bold text-slate-900">{value}</div>{trend && <span className="text-xs font-bold text-emerald-600">{trend}</span>}</div></div>;
}
function StatCard({ label, value, change, icon: Icon, tone, detail }: { label: string; value: string; change?: string; icon: typeof CircleDollarSign; tone: string; detail?: string }) {
  return <div className="card p-5"><div className="flex items-start justify-between"><div className={`flex h-10 w-10 items-center justify-center rounded-xl ${tone}`}><Icon size={19} /></div>{change && <span className="flex items-center gap-1 text-xs font-bold text-emerald-600">{change}</span>}</div><div className="mt-5 text-[13px] font-semibold text-slate-500">{label}</div><div className="mt-1 font-display text-[26px] font-bold tracking-tight text-slate-900">{value}</div>{detail && <div className="mt-1 text-xs text-slate-400">{detail}</div>}</div>;
}
function Empty({ text }: { text: string }) { return <div className="p-10 text-center text-sm text-slate-400">{text}</div>; }
function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 backdrop-blur-sm sm:items-center sm:p-4"><div className="scroll-touch flex max-h-[92vh] w-full max-w-lg flex-col overflow-y-auto rounded-t-3xl bg-white p-5 shadow-2xl sm:rounded-3xl sm:p-6"><div className="mb-6 flex items-center justify-between"><h3 className="font-display text-lg font-bold text-slate-900">{title}</h3><button onClick={onClose} className="icon-button"><X size={19} /></button></div>{children}</div></div>;
}

// ===================== Customers =====================

export function ConnectedCustomersPage() {
  const [items, setItems] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showNew, setShowNew] = useState(false);
  const [error, setError] = useState('');

  async function refresh() {
    setLoading(true); setError('');
    try { setItems(await loadCustomers()); } catch { setError('Impossible de charger les clients.'); } finally { setLoading(false); }
  }
  useEffect(() => { refresh(); }, []);

  const filtered = items.filter(c => `${c.full_name} ${c.phone}`.toLowerCase().includes(search.toLowerCase()));

  return <PageShell title="Clients & véhicules" subtitle="Centralisez vos clients, leurs véhicules et leur fidélité." action="Nouveau client" onAction={() => setShowNew(true)}>
    <div className="grid gap-4 sm:grid-cols-3">
      <MiniStat label="Clients enregistrés" value={String(items.length)} />
      <MiniStat label="Visites cumulées" value={String(items.reduce((s, c) => s + c.visits, 0))} />
      <MiniStat label="Points distribués" value={items.reduce((s, c) => s + c.loyalty_points, 0).toLocaleString('fr-FR')} />
    </div>
    {error && <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>}
    <div className="card overflow-hidden">
      <div className="border-b border-slate-100 p-4"><div className="relative max-w-sm"><Search className="absolute left-3 top-3 text-slate-400" size={17} /><input className="input pl-10" placeholder="Rechercher un client…" value={search} onChange={e => setSearch(e.target.value)} /></div></div>
      {loading ? <Empty text="Chargement des clients…" /> : filtered.length === 0 ? <Empty text="Aucun client trouvé." /> : (
        <div className="table-scroll"><table className="w-full text-left">
          <thead><tr className="border-b border-slate-100 text-[10px] font-bold uppercase tracking-[.08em] text-slate-400"><th className="px-5 py-3">Client</th><th className="px-3 py-3">Véhicule principal</th><th className="px-3 py-3">Visites</th><th className="px-3 py-3">Dépensé</th><th className="px-5 py-3 text-right">Points</th></tr></thead>
          <tbody>{filtered.map(c => <tr key={c.id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/70"><td className="px-5 py-4"><div className="flex items-center gap-3"><div className="flex h-9 w-9 items-center justify-center rounded-full bg-cyan-50 text-sm font-bold text-cyan-700">{c.full_name.split(' ').map(n => n[0]).join('').slice(0, 2)}</div><div><div className="text-sm font-bold text-slate-800">{c.full_name}</div><div className="mt-1 text-xs text-slate-400">{c.phone}</div></div></div></td><td className="px-3 py-4 text-sm text-slate-600">{c.vehicle_label || '—'}</td><td className="px-3 py-4 text-sm font-semibold text-slate-700">{c.visits}</td><td className="px-3 py-4 text-sm font-semibold text-slate-700">{formatUsd(Number(c.total_spent))}</td><td className="px-5 py-4 text-right"><span className="badge bg-amber-50 text-amber-700">{c.loyalty_points} pts</span></td></tr>)}</tbody>
        </table></div>
      )}
    </div>
    {showNew && <NewCustomerModal onClose={() => setShowNew(false)} onCreated={() => { setShowNew(false); refresh(); }} />}
  </PageShell>;
}

function NewCustomerModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState(''); const [phone, setPhone] = useState(''); const [email, setEmail] = useState(''); const [saving, setSaving] = useState(false); const [error, setError] = useState('');
  const [plate, setPlate] = useState(''); const [brand, setBrand] = useState(''); const [model, setModel] = useState(''); const [color, setColor] = useState(''); const [vtype, setVtype] = useState('Berline');
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setSaving(true); setError('');
    try { await createCustomerWithVehicle({ full_name: name, phone, email: email || undefined, plate_number: plate || undefined, brand: brand || undefined, model: model || undefined, color: color || undefined, vehicle_type: vtype || undefined }); onCreated(); } catch { setError('Impossible d’enregistrer le client.'); } finally { setSaving(false); }
  }
  return <Modal title="Nouveau client" onClose={onClose}><form onSubmit={submit} className="space-y-4">
    <div><label className="label">Nom complet</label><input className="input" value={name} onChange={e => setName(e.target.value)} required /></div>
    <div className="grid grid-cols-2 gap-3"><div><label className="label">Téléphone</label><input className="input" value={phone} onChange={e => setPhone(e.target.value)} placeholder="+243 …" /></div><div><label className="label">E-mail (optionnel)</label><input className="input" type="email" value={email} onChange={e => setEmail(e.target.value)} /></div></div>
    <div className="rounded-xl border border-slate-200 p-4 space-y-3"><div className="text-xs font-bold uppercase tracking-[.08em] text-slate-400">Informations du véhicule</div>
      <div className="grid grid-cols-2 gap-3"><div><label className="label">Plaque</label><input className="input" value={plate} onChange={e => setPlate(e.target.value)} placeholder="CG 4821 AB" /></div><div><label className="label">Marque</label><input className="input" value={brand} onChange={e => setBrand(e.target.value)} placeholder="Toyota" /></div></div>
      <div className="grid grid-cols-2 gap-3"><div><label className="label">Modèle</label><input className="input" value={model} onChange={e => setModel(e.target.value)} placeholder="Rav4" /></div><div><label className="label">Couleur</label><input className="input" value={color} onChange={e => setColor(e.target.value)} placeholder="Noir" /></div></div>
      <div><label className="label">Type de véhicule</label><select className="input" value={vtype} onChange={e => setVtype(e.target.value)}><option>Berline</option><option>SUV</option><option>Pickup</option><option>Monospace</option><option>Moto</option><option>Camion</option></select></div>
    </div>
    {error && <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{error}</div>}
    <button className="primary-button h-11 w-full" disabled={saving}><Check size={17} /> {saving ? 'Enregistrement…' : 'Enregistrer'}</button>
  </form></Modal>;
}

// ===================== Inventory =====================

export function ConnectedInventoryPage() {
  const [items, setItems] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showNew, setShowNew] = useState(false);
  const [error, setError] = useState('');

  async function refresh() {
    setLoading(true); setError('');
    try { setItems(await loadProducts()); } catch { setError('Impossible de charger le stock.'); } finally { setLoading(false); }
  }
  useEffect(() => { refresh(); }, []);

  const filtered = items.filter(p => p.name.toLowerCase().includes(search.toLowerCase()));
  const alerts = items.filter(p => Number(p.current_stock) <= Number(p.minimum_stock)).length;
  const stockValue = items.reduce((s, p) => s + Number(p.current_stock) * Number(p.unit_cost), 0);

  return <PageShell title="Stocks" subtitle="Contrôlez vos consommables et recevez les alertes de rupture." action="Ajouter un article" onAction={() => setShowNew(true)}>
    <div className="grid gap-4 sm:grid-cols-3">
      <MiniStat label="Valeur du stock" value={formatUsd(stockValue)} />
      <MiniStat label="Articles suivis" value={String(items.length)} />
      <MiniStat label="Alertes actives" value={String(alerts)} trend={alerts > 0 ? 'À traiter' : undefined} />
    </div>
    {error && <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>}
    <div className="card overflow-hidden">
      <div className="flex items-center justify-between border-b border-slate-100 p-4"><div className="relative max-w-sm"><Search className="absolute left-3 top-3 text-slate-400" size={17} /><input className="input pl-10" placeholder="Rechercher un article…" value={search} onChange={e => setSearch(e.target.value)} /></div></div>
      {loading ? <Empty text="Chargement du stock…" /> : filtered.length === 0 ? <Empty text="Aucun article trouvé." /> : (
        <div className="divide-y divide-slate-50">{filtered.map(p => {
          const stock = Number(p.current_stock); const min = Number(p.minimum_stock); const level = Math.min(100, Math.round((stock / (min * 3 || 1)) * 100)); const critical = stock <= min;
          return <div key={p.id} className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center">
            <div className="flex flex-1 items-center gap-3"><div className={`flex h-10 w-10 items-center justify-center rounded-xl ${critical ? 'bg-rose-50 text-rose-600' : 'bg-slate-100 text-slate-500'}`}><Package size={19} /></div><div><div className="text-sm font-bold text-slate-800">{p.name}</div><div className="mt-1 text-xs text-slate-400">{p.category}</div></div></div>
            <div className="w-full sm:w-48"><div className="mb-2 flex justify-between text-xs"><span className="font-semibold text-slate-700">{stock} {p.unit}</span><span className="text-slate-400">min. {min} {p.unit}</span></div><div className="h-2 overflow-hidden rounded-full bg-slate-100"><div className={`h-full rounded-full ${critical ? 'bg-rose-500' : level > 60 ? 'bg-emerald-500' : 'bg-amber-500'}`} style={{ width: `${level}%` }} /></div></div>
            <div className="w-28 text-right">{critical ? <span className="badge bg-rose-50 text-rose-700">Stock critique</span> : <span className="badge bg-emerald-50 text-emerald-700">Normal</span>}</div>
            <div className="flex gap-1"><button onClick={() => quickMove(p.id, 'in', refresh)} className="icon-button" title="Entrée"><ArrowDownLeft size={16} /></button><button onClick={() => quickMove(p.id, 'out', refresh)} className="icon-button" title="Sortie"><ArrowUpRight size={16} /></button><button className="icon-button"><MoreHorizontal size={18} /></button></div>
          </div>;
        })}</div>
      )}
    </div>
    {showNew && <NewProductModal onClose={() => setShowNew(false)} onCreated={() => { setShowNew(false); refresh(); }} />}
  </PageShell>;
}

async function quickMove(productId: string, type: string, after: () => void) {
  const qty = type === 'in' ? 5 : 1;
  try { await recordStockMovement(productId, type, qty, type === 'in' ? 'Réapprovisionnement' : 'Consommation'); after(); } catch { /* ignore */ }
}

function NewProductModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState(''); const [category, setCategory] = useState('Consommable'); const [unit, setUnit] = useState('unité'); const [stock, setStock] = useState('0'); const [min, setMin] = useState('0'); const [cost, setCost] = useState('0'); const [saving, setSaving] = useState(false); const [error, setError] = useState('');
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setSaving(true); setError('');
    try { await createProduct({ name, category, unit, current_stock: Number(stock), minimum_stock: Number(min), unit_cost: Number(cost) }); onCreated(); } catch { setError('Impossible d’ajouter l’article.'); } finally { setSaving(false); }
  }
  return <Modal title="Nouvel article" onClose={onClose}><form onSubmit={submit} className="space-y-4"><div><label className="label">Nom</label><input className="input" value={name} onChange={e => setName(e.target.value)} required /></div><div className="grid grid-cols-2 gap-3"><div><label className="label">Catégorie</label><input className="input" value={category} onChange={e => setCategory(e.target.value)} /></div><div><label className="label">Unité</label><input className="input" value={unit} onChange={e => setUnit(e.target.value)} /></div></div><div className="grid grid-cols-3 gap-3"><div><label className="label">Stock actuel</label><input className="input" type="number" value={stock} onChange={e => setStock(e.target.value)} /></div><div><label className="label">Stock min.</label><input className="input" type="number" value={min} onChange={e => setMin(e.target.value)} /></div><div><label className="label">Coût unit.</label><input className="input" type="number" value={cost} onChange={e => setCost(e.target.value)} /></div></div>{error && <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{error}</div>}<button className="primary-button h-11 w-full" disabled={saving}><Check size={17} /> {saving ? 'Enregistrement…' : 'Ajouter'}</button></form></Modal>;
}

// ===================== Expenses =====================

export function ConnectedExpensesPage() {
  const [items, setItems] = useState<Expense[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);
  const [error, setError] = useState('');

  async function refresh() {
    setLoading(true); setError('');
    try { setItems(await loadExpenses()); } catch { setError('Impossible de charger les dépenses.'); } finally { setLoading(false); }
  }
  useEffect(() => { refresh(); }, []);

  const totalMonth = items.reduce((s, e) => s + Number(e.amount), 0);
  const pending = items.filter(e => e.status === 'pending').reduce((s, e) => s + Number(e.amount), 0);

  async function changeStatus(id: string, status: string) { try { await updateExpenseStatus(id, status); refresh(); } catch { /* ignore */ } }

  return <PageShell title="Dépenses" subtitle="Suivez les sorties et gardez le contrôle sur vos coûts." action="Nouvelle dépense" onAction={() => setShowNew(true)}>
    <div className="grid gap-4 sm:grid-cols-3">
      <StatCard label="Dépenses enregistrées" value={formatUsd(totalMonth)} icon={ArrowUpRight} tone="bg-rose-50 text-rose-600" />
      <StatCard label="En attente de validation" value={formatUsd(pending)} icon={Clock3} tone="bg-amber-50 text-amber-600" />
      <StatCard label="Nombre de dépenses" value={String(items.length)} icon={BarChart3} tone="bg-cyan-50 text-cyan-700" />
    </div>
    {error && <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>}
    <div className="card overflow-hidden">
      <div className="border-b border-slate-100 p-5"><h3 className="font-display font-bold text-slate-900">Dépenses récentes</h3></div>
      {loading ? <Empty text="Chargement des dépenses…" /> : items.length === 0 ? <Empty text="Aucune dépense enregistrée." /> : (
        <div className="table-scroll"><table className="w-full text-left">
          <thead><tr className="border-b border-slate-100 text-[10px] font-bold uppercase tracking-[.08em] text-slate-400"><th className="px-5 py-3">Description</th><th className="px-3 py-3">Catégorie</th><th className="px-3 py-3">Date</th><th className="px-3 py-3">Montant</th><th className="px-5 py-3 text-right">Statut</th></tr></thead>
          <tbody>{items.map(e => <tr key={e.id} className="border-b border-slate-50 last:border-0"><td className="px-5 py-4 text-sm font-semibold text-slate-700">{e.description || '—'}</td><td className="px-3 py-4 text-sm text-slate-500">{e.category}</td><td className="px-3 py-4 text-sm text-slate-500">{new Date(e.created_at).toLocaleDateString('fr-FR')}</td><td className="px-3 py-4 text-sm font-bold text-slate-700">{formatUsd(Number(e.amount))}</td><td className="px-5 py-4 text-right">{e.status === 'pending' ? <div className="flex justify-end gap-1"><button onClick={() => changeStatus(e.id, 'approved')} className="badge bg-emerald-50 text-emerald-700 hover:bg-emerald-100">Valider</button><button onClick={() => changeStatus(e.id, 'rejected')} className="badge bg-rose-50 text-rose-700 hover:bg-rose-100">Rejeter</button></div> : <span className={`badge ${e.status === 'approved' ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'}`}>{e.status === 'approved' ? 'Validée' : 'Rejetée'}</span>}</td></tr>)}</tbody>
        </table></div>
      )}
    </div>
    {showNew && <NewExpenseModal onClose={() => setShowNew(false)} onCreated={() => { setShowNew(false); refresh(); }} />}
  </PageShell>;
}

function NewExpenseModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [desc, setDesc] = useState(''); const [category, setCategory] = useState('Approvisionnement'); const [amount, setAmount] = useState(''); const [saving, setSaving] = useState(false); const [error, setError] = useState('');
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setSaving(true); setError('');
    try { await createExpense({ description: desc, category, amount: Number(amount), currency: 'USD' }); onCreated(); } catch { setError('Impossible d’enregistrer la dépense.'); } finally { setSaving(false); }
  }
  return <Modal title="Nouvelle dépense" onClose={onClose}><form onSubmit={submit} className="space-y-4"><div><label className="label">Description</label><input className="input" value={desc} onChange={e => setDesc(e.target.value)} required /></div><div><label className="label">Catégorie</label><select className="input" value={category} onChange={e => setCategory(e.target.value)}><option>Approvisionnement</option><option>Maintenance</option><option>Services</option><option>Fournitures</option><option>Salaires</option><option>Autre</option></select></div><div><label className="label">Montant (USD)</label><input className="input" type="number" step="0.01" value={amount} onChange={e => setAmount(e.target.value)} required /></div>{error && <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{error}</div>}<button className="primary-button h-11 w-full" disabled={saving}><Check size={17} /> {saving ? 'Enregistrement…' : 'Enregistrer'}</button></form></Modal>;
}

// ===================== Employees =====================

export function ConnectedEmployeesPage() {
  const [items, setItems] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showNew, setShowNew] = useState(false);
  const [error, setError] = useState('');

  async function refresh() {
    setLoading(true); setError('');
    try { setItems(await loadEmployees()); } catch { setError('Impossible de charger l’équipe.'); } finally { setLoading(false); }
  }
  useEffect(() => { refresh(); }, []);

  const filtered = items.filter(e => `${e.full_name} ${e.role}`.toLowerCase().includes(search.toLowerCase()));
  const active = items.filter(e => e.is_active).length;

  return <PageShell title="Équipe" subtitle="Gérez les employés, présences et performances." action="Ajouter un employé" onAction={() => setShowNew(true)}>
    <div className="grid gap-4 sm:grid-cols-3">
      <MiniStat label="Employés actifs" value={String(active)} />
      <MiniStat label="Total enregistré" value={String(items.length)} />
      <MiniStat label="Taux d’activité" value={items.length ? `${Math.round(active / items.length * 100)}%` : '—'} />
    </div>
    {error && <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>}
    <div className="card overflow-hidden">
      <div className="border-b border-slate-100 p-4"><div className="relative max-w-sm"><Search className="absolute left-3 top-3 text-slate-400" size={17} /><input className="input pl-10" placeholder="Rechercher un employé…" value={search} onChange={e => setSearch(e.target.value)} /></div></div>
      {loading ? <Empty text="Chargement de l’équipe…" /> : filtered.length === 0 ? <Empty text="Aucun employé trouvé." /> : (
        <div className="divide-y divide-slate-50">{filtered.map(e => <div key={e.id} className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center"><div className="flex flex-1 items-center gap-3"><div className="flex h-10 w-10 items-center justify-center rounded-full bg-cyan-50 font-bold text-cyan-700">{e.full_name.split(' ').map(n => n[0]).join('').slice(0, 2)}</div><div><div className="text-sm font-bold text-slate-800">{e.full_name}</div><div className="mt-1 text-xs text-slate-400">{e.role} · {e.phone || '—'}</div></div></div><span className={`badge ${e.is_active ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>{e.is_active ? 'Actif' : 'Inactif'}</span><button className="icon-button"><MoreHorizontal size={18} /></button></div>)}</div>
      )}
    </div>
    {showNew && <NewEmployeeModal onClose={() => setShowNew(false)} onCreated={() => { setShowNew(false); refresh(); }} />}
  </PageShell>;
}

function NewEmployeeModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState(''); const [role, setRole] = useState('operator'); const [phone, setPhone] = useState(''); const [saving, setSaving] = useState(false); const [error, setError] = useState('');
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setSaving(true); setError('');
    try { await createEmployee({ full_name: name, role, phone }); onCreated(); } catch { setError('Impossible d’ajouter l’employé.'); } finally { setSaving(false); }
  }
  return <Modal title="Nouvel employé" onClose={onClose}><form onSubmit={submit} className="space-y-4"><div><label className="label">Nom complet</label><input className="input" value={name} onChange={e => setName(e.target.value)} required /></div><div><label className="label">Rôle</label><select className="input" value={role} onChange={e => setRole(e.target.value)}><option value="operator">Opérateur</option><option value="cashier">Caissier</option><option value="manager">Manager</option><option value="stock_manager">Gestionnaire de stock</option></select></div><div><label className="label">Téléphone</label><input className="input" value={phone} onChange={e => setPhone(e.target.value)} placeholder="+243 …" /></div>{error && <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{error}</div>}<button className="primary-button h-11 w-full" disabled={saving}><Check size={17} /> {saving ? 'Enregistrement…' : 'Ajouter'}</button></form></Modal>;
}

// ===================== Cash Register =====================

export function ConnectedCashPage() {
  const [register, setRegister] = useState<CashRegister | null>(null);
  const [movements, setMovements] = useState<CashMovement[]>([]);
  const [loading, setLoading] = useState(true);
  const [showOpen, setShowOpen] = useState(false);
  const [showClose, setShowClose] = useState(false);
  const [error, setError] = useState('');

  async function refresh() {
    setLoading(true); setError('');
    try { const data = await loadCashRegister(); setRegister(data.register); setMovements(data.movements); } catch { setError('Impossible de charger la caisse.'); } finally { setLoading(false); }
  }
  useEffect(() => { refresh(); }, []);

  const salesIn = movements.filter(m => m.type === 'sale').reduce((s, m) => s + Number(m.amount), 0);
  const expensesOut = movements.filter(m => m.type === 'expense').reduce((s, m) => s + Number(m.amount), 0);
  const theoretical = register ? Number(register.opening_usd) + salesIn - expensesOut : 0;

  return <PageShell title="Caisse" subtitle="Suivez les encaissements, mouvements et clôtures de la journée." action={register ? undefined : 'Ouvrir une caisse'} onAction={register ? undefined : () => setShowOpen(true)}>
    <div className="grid gap-4 sm:grid-cols-3">
      <StatCard label="Solde théorique USD" value={formatUsd(theoretical)} icon={CircleDollarSign} tone="bg-cyan-50 text-cyan-700" />
      <StatCard label="Encaissements" value={formatUsd(salesIn)} icon={ArrowDownLeft} tone="bg-emerald-50 text-emerald-600" />
      <StatCard label="Dépenses" value={formatUsd(expensesOut)} icon={ArrowUpRight} tone="bg-rose-50 text-rose-600" />
    </div>
    {error && <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>}
    <div className="grid gap-6 xl:grid-cols-[1fr_1.2fr]">
      <div className="card p-5">
        <div className="flex items-center justify-between"><div><h3 className="font-display font-bold text-slate-900">Caisse {register ? 'ouverte' : 'fermée'}</h3><p className="mt-1 text-xs text-slate-400">{register ? `Ouverte le ${new Date(register.opened_at).toLocaleString('fr-FR')}` : 'Aucune caisse ouverte actuellement'}</p></div>{register && <span className="badge bg-emerald-50 text-emerald-700"><span className="h-1.5 w-1.5 rounded-full bg-current" /> Ouverte</span>}</div>
        {register && <div className="mt-6 space-y-4">
          <div className="flex items-center justify-between text-sm"><span className="text-slate-500">Fond de caisse</span><span className="font-bold text-slate-700">{formatUsd(Number(register.opening_usd))}</span></div>
          <div className="flex items-center justify-between text-sm"><span className="text-slate-500">Ventes encaissées</span><span className="font-bold text-emerald-600">{formatUsd(salesIn)}</span></div>
          <div className="flex items-center justify-between text-sm"><span className="text-slate-500">Dépenses</span><span className="font-bold text-rose-600">−{formatUsd(expensesOut)}</span></div>
          <div className="border-t border-slate-100 pt-4"><div className="flex items-center justify-between text-base"><span className="font-bold text-slate-800">Solde théorique</span><span className="font-display text-xl font-bold text-cyan-800">{formatUsd(theoretical)}</span></div></div>
          <button onClick={() => setShowClose(true)} className="secondary-button w-full">Clôturer la caisse</button>
        </div>}
        {!register && !loading && <div className="mt-6"><button onClick={() => setShowOpen(true)} className="primary-button w-full"><WalletCards size={17} /> Ouvrir une caisse</button></div>}
      </div>
      <div className="card overflow-hidden">
        <div className="border-b border-slate-100 p-5"><h3 className="font-display font-bold text-slate-900">Derniers mouvements</h3><p className="mt-1 text-xs text-slate-400">Caisse en cours</p></div>
        {loading ? <Empty text="Chargement…" /> : movements.length === 0 ? <Empty text="Aucun mouvement enregistré." /> : (
          <div className="divide-y divide-slate-50">{movements.map(m => <div key={m.id} className="flex items-center gap-3 p-4"><div className={`flex h-9 w-9 items-center justify-center rounded-lg ${m.type === 'opening' ? 'text-emerald-600 bg-emerald-50' : m.type === 'expense' ? 'text-rose-600 bg-rose-50' : 'text-cyan-700 bg-cyan-50'}`}><ShoppingCart size={16} /></div><div className="flex-1"><div className="text-sm font-semibold text-slate-700">{m.reason || m.type}</div><div className="mt-1 text-xs text-slate-400">{m.currency} · {new Date(m.created_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</div></div><div className={`text-sm font-bold ${m.type === 'expense' ? 'text-rose-600' : 'text-emerald-600'}`}>{m.type === 'expense' ? '−' : '+'}{formatUsd(Number(m.amount))}</div></div>)}</div>
        )}
      </div>
    </div>
    {showOpen && <OpenCashModal onClose={() => setShowOpen(false)} onOpened={() => { setShowOpen(false); refresh(); }} />}
    {showClose && register && <CloseCashModal registerId={register.id} theoretical={theoretical} onClose={() => setShowClose(false)} onClosed={() => { setShowClose(false); refresh(); }} />}
  </PageShell>;
}

function OpenCashModal({ onClose, onOpened }: { onClose: () => void; onOpened: () => void }) {
  const [amount, setAmount] = useState('500'); const [saving, setSaving] = useState(false); const [error, setError] = useState('');
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setSaving(true); setError('');
    try { await openCashRegister(Number(amount)); onOpened(); } catch { setError('Impossible d’ouvrir la caisse.'); } finally { setSaving(false); }
  }
  return <Modal title="Ouvrir une caisse" onClose={onClose}><form onSubmit={submit} className="space-y-4"><div><label className="label">Fond de caisse (USD)</label><input className="input" type="number" step="0.01" value={amount} onChange={e => setAmount(e.target.value)} required /></div>{error && <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{error}</div>}<button className="primary-button h-11 w-full" disabled={saving}><Check size={17} /> {saving ? 'Ouverture…' : 'Ouvrir la caisse'}</button></form></Modal>;
}

function CloseCashModal({ registerId, theoretical, onClose, onClosed }: { registerId: string; theoretical: number; onClose: () => void; onClosed: () => void }) {
  const [counted, setCounted] = useState(String(theoretical.toFixed(2))); const [saving, setSaving] = useState(false); const [error, setError] = useState('');
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setSaving(true); setError('');
    try { await closeCashRegister(registerId, Number(counted)); onClosed(); } catch { setError('Impossible de clôturer la caisse.'); } finally { setSaving(false); }
  }
  return <Modal title="Clôturer la caisse" onClose={onClose}><form onSubmit={submit} className="space-y-4"><div className="rounded-xl bg-cyan-50 p-4"><div className="text-sm font-semibold text-cyan-900">Solde théorique</div><div className="mt-1 font-display text-2xl font-bold text-cyan-800">{formatUsd(theoretical)}</div></div><div><label className="label">Montant compté (USD)</label><input className="input" type="number" step="0.01" value={counted} onChange={e => setCounted(e.target.value)} required /></div>{error && <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{error}</div>}<button className="primary-button h-11 w-full" disabled={saving}><Check size={17} /> {saving ? 'Clôture…' : 'Clôturer'}</button></form></Modal>;
}
