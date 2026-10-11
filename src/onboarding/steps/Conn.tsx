/* ConnNode / ConnLink — presenters used by AnkiStep. Moved verbatim. */
import React, { useState } from 'react';
import { CheckCircle2, AlertTriangle, Loader2, PlugZap } from 'lucide-react';

export function ConnNode({ icon, label, sub, tone }: { icon: React.ReactNode; label: string; sub: string; tone: 'indigo' | 'amber' }) {
  const t = tone === 'indigo'
    ? 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-300 ring-indigo-500/20'
    : 'bg-amber-500/10 text-amber-600 dark:text-amber-300 ring-amber-500/20';
  return (
    <div className="flex flex-col items-center text-center gap-1.5">
      <div className={`w-12 h-12 rounded-2xl ring-1 flex items-center justify-center ${t}`}>{icon}</div>
      <div>
        <div className="text-[12px] font-semibold text-zinc-800 dark:text-zinc-100 leading-tight">{label}</div>
        <div className="text-[10px] text-zinc-500 dark:text-zinc-400 leading-tight mt-0.5">{sub}</div>
      </div>
    </div>
  );
}

export function ConnLink({ busy, ok, err, accentLine }: { busy: boolean; ok: boolean; err: boolean; accentLine: string }) {
  return (
    <div className="relative h-12 w-20 flex items-center justify-center" aria-hidden>
      <div className={`absolute inset-x-0 top-1/2 -translate-y-1/2 h-px ${accentLine} opacity-70`} />
      {busy && (
        <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-px overflow-hidden">
          <div className="h-full w-1/3 bg-white/70 dark:bg-white/40 blur-[1px]" style={{ animation: 'sl-conn-flow 1.2s linear infinite' }} />
        </div>
      )}
      <div className={`relative w-6 h-6 rounded-full flex items-center justify-center bg-white dark:bg-zinc-900 ring-1 ${
        ok ? 'ring-emerald-400 text-emerald-500'
          : err ? 'ring-rose-400 text-rose-500'
            : busy ? 'ring-indigo-400 text-indigo-500'
              : 'ring-zinc-300 dark:ring-zinc-700 text-zinc-400'
      }`}>
        {ok ? <CheckCircle2 size={13} /> : err ? <AlertTriangle size={12} /> : busy ? <Loader2 size={12} className="animate-spin" /> : <PlugZap size={12} />}
      </div>
    </div>
  );
}

/* ─── MappingStep ─────────────────────────────────────────────────────────── */