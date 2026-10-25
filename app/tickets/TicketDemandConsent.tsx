'use client';

import { useEffect, useState } from 'react';

const consentKey = 'ticketing-demand-consent';

export default function TicketDemandConsent() {
  const [choice, setChoice] = useState<'unknown' | 'accepted' | 'declined'>('unknown');
  const [storageBlocked, setStorageBlocked] = useState(false);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(consentKey);
      if (saved === 'accepted' || saved === 'declined') setChoice(saved);
    } catch {
      setStorageBlocked(true);
      setChoice('declined');
    }
  }, []);

  function saveConsent(value: 'accepted' | 'declined') {
    try {
      window.localStorage.setItem(consentKey, value);
    } catch {
      setStorageBlocked(true);
      setChoice('declined');
      return;
    }
    setStorageBlocked(false);
    setChoice(value);
  }

  if (choice !== 'unknown') return null;

  return (
    <aside className="fixed bottom-3 left-3 z-50 max-w-[calc(100vw-1.5rem)] sm:bottom-5 sm:left-5" aria-label="Demand analytics privacy choices">
      <div className="max-w-lg rounded-2xl border border-white/15 bg-[#17121e] p-4 text-white shadow-2xl shadow-black/50">
        <p className="text-xs font-black">Help organizers understand event demand?</p>
        <p className="mt-1.5 text-[11px] leading-5 text-slate-300">
          If you agree, we collect anonymous event views, searches, selected filters and checkout starts. Search text that looks like an email address or phone number is excluded. We do not use this for ad tracking.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" onClick={() => saveConsent('accepted')} className="min-h-9 rounded-lg bg-orange-400 px-3 text-[11px] font-black text-[#170d18]">Allow anonymous analytics</button>
          <button type="button" onClick={() => saveConsent('declined')} className="min-h-9 rounded-lg border border-white/15 px-3 text-[11px] font-bold text-slate-100">No thanks</button>
        </div>
        {storageBlocked && <p role="status" className="mt-2 text-[10px] text-amber-200">Your browser blocked saving this choice. Analytics will stay off.</p>}
      </div>
    </aside>
  );
}
