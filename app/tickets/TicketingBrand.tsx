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
          <svg
            aria-hidden="true"
            className="h-auto w-[245px] sm:w-[300px]"
            viewBox="0 0 560 112"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <defs>
              <linearGradient id="ticketing-crest" x1="10" y1="8" x2="104" y2="104" gradientUnits="userSpaceOnUse">
                <stop stopColor="#342033" />
                <stop offset="1" stopColor="#17111D" />
              </linearGradient>
              <linearGradient id="ticketing-gold" x1="30" y1="25" x2="86" y2="83" gradientUnits="userSpaceOnUse">
                <stop stopColor="#FFE7A3" />
                <stop offset="1" stopColor="#E89B46" />
              </linearGradient>
            </defs>
            <rect x="4" y="4" width="104" height="104" rx="30" fill="url(#ticketing-crest)" stroke="#E7A455" strokeOpacity=".34" />
            <path d="M56 20 62.4 36.6 80 43 63.4 49.4 57 67 50.6 50.4 34 44 50.6 37.6 56 20Z" fill="url(#ticketing-gold)" />
            <path d="m81 66 3.2 8.3 8.8 3.2-8.8 3.2L81 89l-3.2-8.3-8.8-3.2 8.8-3.2L81 66Z" fill="#FFE7A3" />
            <circle cx="34" cy="79" r="3" fill="#EFAF62" />
            <text x="128" y="53" fill="var(--ticket-text)" fontFamily="Arial, Helvetica, sans-serif" fontSize="29" fontWeight="700" letterSpacing="3.4">MIDNIGHT SOCIETY</text>
            <text x="130" y="79" fill="var(--ticket-accent)" fontFamily="Arial, Helvetica, sans-serif" fontSize="12" fontWeight="700" letterSpacing="4.2">KE · OFFICIAL TICKETING</text>
          </svg>
        </Link>
        <div className="text-right">
          <p className="text-[9px] font-bold uppercase tracking-[0.18em] text-slate-500">The official box office</p>
          <p className="mt-1 text-[10px] font-black uppercase tracking-[0.2em] text-orange-200">Secure tickets · Online Bar</p>
        </div>
      </div>
    </header>
  );
}
