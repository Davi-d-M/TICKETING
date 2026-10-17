import Image from 'next/image';
import Link from 'next/link';

export default function TicketingBrand() {
  return (
    <header className="border-b border-white/[0.08] bg-[#0d0a12]">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-4 py-3 sm:px-6 lg:px-8">
        <Link
          href="/tickets"
          aria-label="Midnight Society KE official ticketing home"
          className="inline-flex rounded-xl focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-orange-300"
        >
          <Image
            src="/midnight-society-ticketing.svg"
            alt="Midnight Society KE · Official Ticketing"
            width={560}
            height={112}
            priority
            className="h-auto w-[245px] sm:w-[300px]"
          />
        </Link>
        <div className="text-right">
          <p className="text-[9px] font-bold uppercase tracking-[0.18em] text-slate-500">The official box office</p>
          <p className="mt-1 text-[10px] font-black uppercase tracking-[0.2em] text-orange-200">Secure tickets · Online Bar</p>
        </div>
      </div>
    </header>
  );
}
