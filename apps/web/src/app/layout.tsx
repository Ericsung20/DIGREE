import type {Metadata, Viewport} from 'next';
import './globals.css';
import {SessionGate} from '@/components/session-gate';

export const metadata: Metadata = {
  title: 'DIGREE',
  description: 'Classes, schedules and GPA for UW–Madison',
  icons: {icon: '/digree-icon.svg'},
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#F7F5F2',
};

export default function RootLayout({children}: LayoutProps<'/'>) {
  return (
    <html lang="en">
      <body>
        <SessionGate />
        {children}
      </body>
    </html>
  );
}
