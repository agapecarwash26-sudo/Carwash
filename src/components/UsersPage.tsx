import { useEffect, useState, type ReactNode } from 'react';
import { Check, KeyRound, MoreHorizontal, Plus, Search, ShieldCheck, Trash2, UserPlus, X } from 'lucide-react';
import { createUser, deleteUser, loadUsers, updateEmployeePassword, updateUserRole } from '@/lib/workspace';
import type { Role, UserAccount } from '@/types';

const roleLabels: Record<string, string> = {
  owner: 'Propriétaire',
  admin: 'Administrateur',
  manager: 'Manager',
  cashier: 'Caissier',
  operator: 'Opérateur',
  stock_manager: 'Gestionnaire de stock',
};

function formatUsd(value: number) { return `$${value.toLocaleString('en-US', { minimumFractionDigits: 2 })}`; }
void formatUsd;

function PageShell({ title, subtitle, action, onAction, children }: { title: string; subtitle: string; action?: string; onAction?: () => void; children: ReactNode }) {
  return <div className="space-y-6"><div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end"><div><h2 className="font-display text-2xl font-bold text-slate-900">{title}</h2><p className="mt-1 text-sm text-slate-500">{subtitle}</p></div>{action && <button onClick={onAction} className="primary-button"><Plus size={17} /> {action}</button>}</div>{children}</div>;
}
function Empty({ text }: { text: string }) { return <div className="p-10 text-center text-sm text-slate-400">{text}</div>; }
function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 backdrop-blur-sm sm:items-center sm:p-4"><div className="scroll-touch flex max-h-[92vh] w-full max-w-lg flex-col overflow-y-auto rounded-t-3xl bg-white p-5 shadow-2xl sm:rounded-3xl sm:p-6"><div className="mb-6 flex items-center justify-between"><h3 className="font-display text-lg font-bold text-slate-900">{title}</h3><button onClick={onClose} className="icon-button"><X size={19} /></button></div>{children}</div></div>;
}

export function UsersPage({ currentUserId }: { currentUserId: string }) {
  const [items, setItems] = useState<UserAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showNew, setShowNew] = useState(false);
  const [error, setError] = useState('');
  const [editingRole, setEditingRole] = useState<{ id: string; role: string } | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [passwordTarget, setPasswordTarget] = useState<{ id: string; name: string } | null>(null);
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);

  async function refresh() {
    setLoading(true); setError('');
    try { setItems(await loadUsers()); } catch (e) { setError(e instanceof Error ? e.message : 'Impossible de charger les utilisateurs.'); } finally { setLoading(false); }
  }
  useEffect(() => { refresh(); }, []);
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      const target = e.target as HTMLElement;
      if (!target.closest('[data-user-menu]')) {
        setMenuOpenId(null);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const filtered = items.filter(u => `${u.full_name} ${u.email} ${u.role}`.toLowerCase().includes(search.toLowerCase()));

  async function handleRoleChange(id: string, role: string) {
    try { await updateUserRole(id, role); setEditingRole(null); refresh(); } catch (e) { setError(e instanceof Error ? e.message : 'Impossible de modifier le rôle.'); }
  }

  async function handleDelete(id: string) {
    try { await deleteUser(id); setDeletingId(null); refresh(); } catch (e) { setError(e instanceof Error ? e.message : 'Impossible de supprimer l\'utilisateur.'); }
  }

  async function handlePasswordChange(id: string, newPassword: string) {
    try { await updateEmployeePassword(id, newPassword); setPasswordTarget(null); } catch (e) { setError(e instanceof Error ? e.message : 'Impossible de modifier le mot de passe.'); }
  }

  return <PageShell title="Utilisateurs & rôles" subtitle="Gérez les comptes, les accès et les permissions de votre équipe." action="Nouvel utilisateur" onAction={() => setShowNew(true)}>
    <div className="grid gap-4 sm:grid-cols-3">
      <div className="card p-5"><div className="text-xs font-semibold text-slate-400">Utilisateurs actifs</div><div className="mt-2 font-display text-2xl font-bold text-slate-900">{items.length}</div></div>
      <div className="card p-5"><div className="text-xs font-semibold text-slate-400">Administrateurs</div><div className="mt-2 font-display text-2xl font-bold text-slate-900">{items.filter(u => u.role === 'owner' || u.role === 'admin').length}</div></div>
      <div className="card p-5"><div className="text-xs font-semibold text-slate-400">Opérateurs & staff</div><div className="mt-2 font-display text-2xl font-bold text-slate-900">{items.filter(u => ['manager', 'cashier', 'operator', 'stock_manager'].includes(u.role)).length}</div></div>
    </div>
    {error && <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>}
    <div className="card overflow-hidden">
      <div className="border-b border-slate-100 p-4"><div className="relative max-w-sm"><Search className="absolute left-3 top-3 text-slate-400" size={17} /><input className="input pl-10" placeholder="Rechercher un utilisateur…" value={search} onChange={e => setSearch(e.target.value)} /></div></div>
      {loading ? <Empty text="Chargement des utilisateurs…" /> : filtered.length === 0 ? <Empty text="Aucun utilisateur trouvé." /> : (
        <div className="table-scroll w-full"><table className="min-w-[640px] text-left">
          <thead><tr className="border-b border-slate-100 text-[10px] font-bold uppercase tracking-[.08em] text-slate-400"><th className="px-5 py-3">Utilisateur</th><th className="px-3 py-3">Rôle</th><th className="px-3 py-3">Créé le</th><th className="px-5 py-3 text-right">Actions</th></tr></thead>
          <tbody>{filtered.map(u => <tr key={u.id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/70">
            <td className="px-5 py-4"><div className="flex items-center gap-3"><div className="flex h-9 w-9 items-center justify-center rounded-full bg-cyan-50 text-sm font-bold text-cyan-700">{u.full_name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}</div><div><div className="text-sm font-bold text-slate-800">{u.full_name}{u.id === currentUserId && <span className="ml-2 text-[10px] font-bold uppercase text-cyan-600">Vous</span>}</div><div className="mt-1 text-xs text-slate-400">{u.email}</div></div></div></td>
            <td className="px-3 py-4">{editingRole?.id === u.id ? <select className="input h-9 py-1 text-xs" value={editingRole.role} onChange={e => setEditingRole({ id: u.id, role: e.target.value })} onBlur={() => handleRoleChange(u.id, editingRole.role)}><option value="owner">Propriétaire</option><option value="admin">Administrateur</option><option value="manager">Manager</option><option value="cashier">Caissier</option><option value="operator">Opérateur</option><option value="stock_manager">Gestionnaire de stock</option></select> : <span className={`badge ${u.role === 'owner' ? 'bg-cyan-50 text-cyan-700' : u.role === 'admin' ? 'bg-violet-50 text-violet-700' : 'bg-slate-100 text-slate-600'}`}>{roleLabels[u.role] || u.role}</span>}</td>
            <td className="px-3 py-4 text-sm text-slate-500">{new Date(u.created_at).toLocaleDateString('fr-FR')}</td>
            <td className="px-5 py-4 text-right"><div className="relative flex justify-end gap-1">
              <button onClick={() => setEditingRole({ id: u.id, role: u.role })} className="icon-button" title="Changer le rôle"><ShieldCheck size={16} /></button>
              <button onClick={() => setPasswordTarget({ id: u.id, name: u.full_name })} className="icon-button text-cyan-600 hover:bg-cyan-50" title="Changer le mot de passe"><KeyRound size={16} /></button>
              {u.id !== currentUserId && <button onClick={() => setDeletingId(u.id)} className="icon-button text-rose-500 hover:bg-rose-50" title="Supprimer"><Trash2 size={16} /></button>}
              <button data-user-menu onClick={() => setMenuOpenId(menuOpenId === u.id ? null : u.id)} className="icon-button" title="Plus d'actions"><MoreHorizontal size={18} /></button>
              {menuOpenId === u.id && <div data-user-menu className="absolute right-0 top-10 z-30 w-48 rounded-xl border border-slate-200 bg-white p-1.5 shadow-xl">
                <button onClick={() => { setEditingRole({ id: u.id, role: u.role }); setMenuOpenId(null); }} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50"><ShieldCheck size={15} /> Changer le rôle</button>
                <button onClick={() => { setPasswordTarget({ id: u.id, name: u.full_name }); setMenuOpenId(null); }} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold text-cyan-700 hover:bg-cyan-50"><KeyRound size={15} /> Changer le mot de passe</button>
                {u.id !== currentUserId && <button onClick={() => { setDeletingId(u.id); setMenuOpenId(null); }} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold text-rose-600 hover:bg-rose-50"><Trash2 size={15} /> Supprimer</button>}
              </div>}
            </div></td>
          </tr>)}</tbody>
        </table></div>
      )}
    </div>
    {showNew && <NewUserModal onClose={() => setShowNew(false)} onCreated={() => { setShowNew(false); refresh(); }} />}
    {deletingId && <ConfirmDeleteModal onClose={() => setDeletingId(null)} onConfirm={() => handleDelete(deletingId)} />}
    {passwordTarget && <ChangePasswordModal userName={passwordTarget.name} onClose={() => setPasswordTarget(null)} onSubmit={pwd => handlePasswordChange(passwordTarget.id, pwd)} />}
  </PageShell>;
}

function NewUserModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState(''); const [email, setEmail] = useState(''); const [password, setPassword] = useState(''); const [role, setRole] = useState<Role>('operator'); const [saving, setSaving] = useState(false); const [error, setError] = useState('');
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setSaving(true); setError('');
    try { await createUser({ email, password, full_name: name, role }); onCreated(); } catch (e) { setError(e instanceof Error ? e.message : 'Impossible de créer l\'utilisateur.'); } finally { setSaving(false); }
  }
  return <Modal title="Nouvel utilisateur" onClose={onClose}><form onSubmit={submit} className="space-y-4">
    <div><label className="label">Nom complet</label><input className="input" value={name} onChange={e => setName(e.target.value)} required /></div>
    <div><label className="label">Adresse e-mail</label><input className="input" type="email" value={email} onChange={e => setEmail(e.target.value)} required /></div>
    <div><label className="label">Mot de passe</label><input className="input" type="password" value={password} onChange={e => setPassword(e.target.value)} minLength={6} required /></div>
    <div><label className="label">Rôle</label><select className="input" value={role} onChange={e => setRole(e.target.value as Role)}><option value="admin">Administrateur</option><option value="manager">Manager</option><option value="cashier">Caissier</option><option value="operator">Opérateur</option><option value="stock_manager">Gestionnaire de stock</option></select></div>
    {error && <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{error}</div>}
    <button className="primary-button h-11 w-full" disabled={saving}><UserPlus size={17} /> {saving ? 'Création…' : 'Créer l\'utilisateur'}</button>
  </form></Modal>;
}

function ConfirmDeleteModal({ onClose, onConfirm }: { onClose: () => void; onConfirm: () => void }) {
  return <Modal title="Supprimer l'utilisateur" onClose={onClose}><div className="space-y-4"><p className="text-sm text-slate-600">Êtes-vous sûr de vouloir supprimer cet utilisateur ? Cette action est irréversible.</p><div className="flex gap-3"><button onClick={onConfirm} className="primary-button bg-rose-600 hover:bg-rose-700 flex-1"><Check size={17} /> Confirmer</button><button onClick={onClose} className="secondary-button flex-1">Annuler</button></div></div></Modal>;
}

function ChangePasswordModal({ userName, onClose, onSubmit }: { userName: string; onClose: () => void; onSubmit: (password: string) => void }) {
  const [password, setPassword] = useState(''); const [saving, setSaving] = useState(false); const [error, setError] = useState('');
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setSaving(true); setError('');
    try { onSubmit(password); } catch (e) { setError(e instanceof Error ? e.message : 'Erreur lors de la modification.'); } finally { setSaving(false); }
  }
  return <Modal title={`Mot de passe — ${userName}`} onClose={onClose}><form onSubmit={submit} className="space-y-4">
    <div><label className="label">Nouveau mot de passe</label><input className="input" type="password" value={password} onChange={e => setPassword(e.target.value)} minLength={6} placeholder="Minimum 6 caractères" required autoFocus /></div>
    {error && <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{error}</div>}
    <div className="flex gap-3"><button type="submit" className="primary-button flex-1" disabled={saving}><KeyRound size={17} /> {saving ? 'Enregistrement…' : 'Définir le mot de passe'}</button><button type="button" onClick={onClose} className="secondary-button flex-1">Annuler</button></div>
  </form></Modal>;
}
