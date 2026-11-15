import type {Metadata} from 'next';
import './globals.css';
import {OnboardingGate} from '@/components/onboarding-gate';
import {TabBar} from '@/components/tab-bar';

export const metadata: Metadata = {
  title: 'DIGREE',
  description: 'Schedule-first student planning',
  icons: {icon: '/digree-icon.svg'},
};

export default function RootLayout({children}: LayoutProps<'/'>) {
  return (
    <html lang="en">
      <body className="antialiased">
        <OnboardingGate />
        {children}
        <TabBar />
      </body>
    </html>
  );
}
