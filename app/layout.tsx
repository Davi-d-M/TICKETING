import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: {
    default: 'Midnight Society KE Ticketing',
    template: '%s | Midnight Society KE Ticketing'
  },
  description: 'Discover official Midnight Society KE after-dark events and ticket information.',
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
