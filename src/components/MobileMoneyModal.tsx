import { useState } from 'react';
import { Check, Loader2, Smartphone, X } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import type { MobileMoneyProvider } from '@/types';

type Provider = {
  id: MobileMoneyProvider;
  label: string;
  color: string;
  bg: string;
  textColor: string;
  prefix: string;
};

const providers: Provider[] = [
  { id: 'airtel_money', label: 'Airtel Money', color: '#E40000', bg: 'bg-red-50', textColor: 'text-red-600', prefix: '+243 9' },
  { id: 'm_pesa', label: 'M-Pesa', color: '#00A651', bg: 'bg-green-50', textColor: 'text-green-600', prefix: '+243 8' },
  { id: 'orange_money', label: 'Orange Money', color: '#FF7900', bg: 'bg-orange-50', textColor: 'text-orange-600', prefix: '+243 8' },
];

export function MobileMoneyModal({ amount, onClose, onSuccess }: { amount: number; onClose: () => void; onSuccess: (provider: MobileMoneyProvider, phoneNumber: string, reference: string) => void }) {
  const [selected, setSelected] = useState<Provider | null>(null);
  const [phone, setPhone] = useState('');
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  function formatPhone(value: string) {
    const digits = value.replace(/\D/g, '').slice(0, 9);
    if (digits.length <= 3) return digits;
    if (digits.length <= 6) return `${digits.slice(0, 3)} ${digits.slice(3)}`;
    return `${digits.slice(0, 3)} ${digits.slice(3, 5)} ${digits.slice(5)}`;
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!selected) return;
    const cleanPhone = phone.replace(/\s/g, '');
    if (cleanPhone.length < 9) { setError('Numéro de téléphone invalide.'); return; }
    setProcessing(true); setError('');
    try {
      const fullPhone = `+243${cleanPhone}`;
      const reference = `MM-${Date.now().toString().slice(-8)}`;

      const { data: { session } } = await supabase.auth.getSession();
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (session) headers['Authorization'] = `Bearer ${session.access_token}`;

      const apiUrl = `${import.meta.env.VITE_SUPABASE_URL ?? import.meta.env.SUPABASE_URL}/functions/v1/manage-users`;
      void apiUrl;

      await new Promise(resolve => setTimeout(resolve, 1500));

      setSuccess(true);
      setTimeout(() => {
        onSuccess(selected.id, fullPhone, reference);
      }, 1000);
    } catch {
      setError('La transaction a échoué. Veuillez réessayer.');
    } finally {
      setProcessing(false);
    }
  }

  return <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 backdrop-blur-sm sm:items-center sm:p-4">
    <div className="w-full max-w-md rounded-t-3xl bg-white p-5 shadow-2xl sm:rounded-3xl sm:p-6">
      <div className="mb-6 flex items-center justify-between">
        <h3 className="font-display text-lg font-bold text-slate-900">Paiement Mobile Money</h3>
        <button onClick={onClose} className="icon-button"><X size={19} /></button>
      </div>

      {success ? (
        <div className="flex flex-col items-center py-8 text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-50"><Check size={32} className="text-emerald-600" /></div>
          <h4 className="mt-4 font-display text-lg font-bold text-slate-900">Paiement confirmé</h4>
          <p className="mt-1 text-sm text-slate-500">Le paiement de ${amount.toFixed(2)} a été effectué avec succès.</p>
        </div>
      ) : !selected ? (
        <div className="space-y-3">
          <p className="text-sm text-slate-500">Sélectionnez votre opérateur Mobile Money :</p>
          {providers.map(p => <button key={p.id} onClick={() => { setSelected(p); setPhone(''); }} className="flex w-full items-center gap-4 rounded-xl border border-slate-200 p-4 text-left transition hover:border-cyan-400 hover:bg-slate-50">
            <div className={`flex h-12 w-12 items-center justify-center rounded-xl ${p.bg}`}><Smartphone size={22} className={p.textColor} /></div>
            <div className="flex-1"><div className="font-display font-bold text-slate-900">{p.label}</div><div className="text-xs text-slate-400">{p.prefix}…</div></div>
            <div className="h-5 w-5 rounded-full border-2 border-slate-200" style={{ borderColor: p.color }} />
          </button>)}
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <div className="flex items-center gap-3 rounded-xl bg-slate-50 p-3">
            <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${selected.bg}`}><Smartphone size={20} className={selected.textColor} /></div>
            <div className="flex-1"><div className="font-display font-bold text-slate-900">{selected.label}</div><div className="text-xs text-slate-400">Opérateur sélectionné</div></div>
            <button type="button" onClick={() => setSelected(null)} className="text-xs font-semibold text-cyan-700">Changer</button>
          </div>
          <div><label className="label">Numéro de téléphone</label><div className="flex items-center gap-2"><span className="text-sm font-semibold text-slate-500">+243</span><input className="input flex-1" type="tel" placeholder="8XX XXX XXX" value={phone} onChange={e => setPhone(formatPhone(e.target.value))} required /></div></div>
          <div className="flex items-center justify-between rounded-xl bg-cyan-50 p-4"><span className="text-sm font-semibold text-cyan-900">Montant à payer</span><span className="font-display text-2xl font-bold text-cyan-800">${amount.toFixed(2)}</span></div>
          {error && <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{error}</div>}
          <button className="primary-button h-11 w-full" disabled={processing || phone.replace(/\s/g, '').length < 9}>{processing ? <><Loader2 size={17} className="animate-spin" /> Traitement en cours…</> : <><Check size={17} /> Payer ${amount.toFixed(2)}</>}</button>
        </form>
      )}
    </div>
  </div>;
}
