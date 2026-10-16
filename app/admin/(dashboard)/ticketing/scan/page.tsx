'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, Camera, CameraOff, ScanLine, ShieldAlert } from 'lucide-react';

type EventOption = { id: string; title: string; status: string };
type ScanResult = { result?: { result?: string; ticket_reference?: string } };
type Detector = { detect(source: HTMLVideoElement): Promise<Array<{ rawValue: string }>> };
type DetectorConstructor = new (options: { formats: string[] }) => Detector;

export default function TicketingScanPage() {
  const [events, setEvents] = useState<EventOption[]>([]);
  const [eventId, setEventId] = useState('');
  const [gateName, setGateName] = useState('Main gate');
  const [credential, setCredential] = useState('');
  const [result, setResult] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [cameraOn, setCameraOn] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    void fetch('/api/admin/ticketing', { cache: 'no-store' })
      .then(async response => {
        const data = await response.json() as { events?: EventOption[]; error?: string };
        if (!response.ok) throw new Error(data.error || 'Ticket events could not be loaded.');
        const available = (data.events || []).filter(event => ['scheduled', 'on_sale', 'sold_out'].includes(event.status));
        setEvents(available);
        if (available.length) setEventId(available[0].id);
      })
      .catch(cause => setError(cause instanceof Error ? cause.message : 'Ticket events could not be loaded.'));
  }, []);

  const scan = useCallback(async (value: string) => {
    const scanned = value.trim();
    if (!eventId || !scanned || busy) return;
    setBusy(true);
    setCredential('');
    setError('');
    setResult('');
    try {
      const response = await fetch('/api/admin/ticketing/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eventId, credential: scanned, gateName })
      });
      const data = await response.json() as ScanResult & { error?: string };
      if (!response.ok) throw new Error(data.error || 'Ticket scan could not be validated.');
      const decision = data.result?.result || 'invalid';
      setResult(decision === 'accepted'
        ? `ADMIT · ${data.result?.ticket_reference || 'Ticket valid'}`
        : decision.replaceAll('_', ' ').toUpperCase());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Ticket scan could not be validated.');
    } finally {
      setBusy(false);
    }
  }, [busy, eventId, gateName]);

  useEffect(() => {
    const video = videoRef.current;
    if (!cameraOn || !video) return;
    const DetectorAPI = (window as Window & { BarcodeDetector?: DetectorConstructor }).BarcodeDetector;
    if (!DetectorAPI || !navigator.mediaDevices?.getUserMedia) {
      setError('Camera QR scanning is not supported here. Connect a keyboard-style QR scanner and use the scan field.');
      setCameraOn(false);
      return;
    }

    let active = true;
    let scanning = false;
    let timer: number | undefined;
    const detector = new DetectorAPI({ formats: ['qr_code'] });
    void navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false })
      .then(stream => {
        if (!active) {
          stream.getTracks().forEach(track => track.stop());
          return;
        }
        streamRef.current = stream;
        video.srcObject = stream;
        void video.play();
        timer = window.setInterval(async () => {
          if (!active || scanning || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;
          scanning = true;
          try {
            const codes = await detector.detect(video);
            const code = codes.find(item => item.rawValue)?.rawValue;
            if (code) {
              setCameraOn(false);
              await scan(code);
            }
          } catch {
            setError('Camera could not read the QR code. Adjust the camera or use a handheld scanner.');
          } finally {
            scanning = false;
          }
        }, 350);
      })
      .catch(cause => {
        setError(cause instanceof Error ? cause.message : 'Camera access was denied.');
        setCameraOn(false);
      });

    return () => {
      active = false;
      if (timer !== undefined) window.clearInterval(timer);
      streamRef.current?.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    };
  }, [cameraOn, scan]);

  return (
    <main className="min-h-screen bg-[#0d0a12] px-4 py-6 text-white sm:px-6">
      <div className="mx-auto max-w-3xl space-y-5">
        <header className="rounded-3xl border border-orange-300/15 bg-gradient-to-br from-[#281626] via-[#1b1221] to-[#120e18] p-6 sm:p-8">
          <Link href="/admin/ticketing" className="inline-flex items-center gap-2 text-xs font-bold text-slate-400 hover:text-white"><ArrowLeft size={14} /> Ticketing management</Link>
          <p className="mt-6 text-xs font-black uppercase tracking-[0.2em] text-orange-200">ONLINE BAR · Gate operations</p>
          <h1 className="mt-2 text-3xl font-black">Ticket scanner</h1>
          <p className="mt-2 text-sm leading-6 text-slate-300">Every scan is validated by the server; the first valid entry is admitted atomically and duplicate scans are rejected.</p>
        </header>

        <section className="space-y-4 rounded-2xl border border-white/10 bg-[#17121e] p-5 sm:p-7">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="text-xs font-bold text-slate-300">Event<select value={eventId} onChange={event => setEventId(event.target.value)} className="mt-1.5 min-h-11 w-full rounded-xl border border-white/10 bg-[#0d0a12] px-3 text-sm text-white" disabled={!events.length}>{events.length ? events.map(item => <option key={item.id} value={item.id}>{item.title}</option>) : <option value="">No events on sale</option>}</select></label>
            <label className="text-xs font-bold text-slate-300">Gate<input value={gateName} onChange={event => setGateName(event.target.value)} maxLength={120} className="mt-1.5 min-h-11 w-full rounded-xl border border-white/10 bg-[#0d0a12] px-3 text-sm text-white" /></label>
          </div>
          {cameraOn && <video ref={videoRef} playsInline muted className="mx-auto aspect-square max-h-80 w-full rounded-xl bg-black object-cover" aria-label="Live QR scanner camera" />}
          <div className="flex flex-wrap gap-3">
            <button type="button" onClick={() => { setError(''); setCameraOn(value => !value); }} disabled={!eventId || busy} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-white/15 px-4 text-xs font-black hover:bg-white/5 disabled:opacity-40">{cameraOn ? <CameraOff size={16} /> : <Camera size={16} />}{cameraOn ? 'Stop camera' : 'Start camera scanner'}</button>
          </div>
          <form onSubmit={event => { event.preventDefault(); void scan(credential); }} className="flex gap-2">
            <label htmlFor="ticket-credential" className="sr-only">Scanned ticket code</label>
            <input id="ticket-credential" autoComplete="off" autoCapitalize="off" value={credential} onChange={event => setCredential(event.target.value)} placeholder="Scan QR with camera or handheld scanner" className="min-h-12 min-w-0 flex-1 rounded-xl border border-white/10 bg-[#0d0a12] px-3 text-sm text-white outline-none focus:border-orange-300" />
            <button disabled={!eventId || !credential.trim() || busy} className="inline-flex min-h-12 items-center gap-2 rounded-xl bg-orange-400 px-4 text-xs font-black text-[#170d18] disabled:opacity-40"><ScanLine size={16} />{busy ? 'Checking…' : 'Check in'}</button>
          </form>
          {result && <p role="status" aria-live="assertive" className={`rounded-xl p-5 text-center text-xl font-black ${result.startsWith('ADMIT') ? 'bg-emerald-950/50 text-emerald-200' : 'bg-red-950/50 text-red-200'}`}>{result}</p>}
          {error && <p role="alert" className="rounded-xl border border-red-300/20 bg-red-950/30 p-4 text-sm text-red-100">{error}</p>}
          <p className="flex gap-2 text-[10px] leading-5 text-slate-500"><ShieldAlert size={14} className="mt-0.5 shrink-0" />Access is restricted to Ticketing platform admins. Keep this scanner online; offline admission is not supported.</p>
        </section>
      </div>
    </main>
  );
}
