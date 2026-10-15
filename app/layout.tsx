import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: {
    default: 'ONLINE BAR Ticketing',
    template: '%s | ONLINE BAR Ticketing'
  },
  description: 'Discover official ONLINE BAR after-dark events and ticket information.',
  robots: {
    index: true,
    follow: true
  }
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
