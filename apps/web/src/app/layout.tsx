import type {Metadata} from 'next';
import './globals.css';
import {OnboardingGate} from '@/components/onboarding-gate';
import {TabBar} from '@/components/tab-bar';

export const metadata: Metadata = {
  title: 'DIGREE',
  description: 'Schedule-first student planning',
};

export default function RootLayout({children}: LayoutProps<'/'>) {
  return (
    <html lang="en">
      <body className="bg-white text-neutral-900 antialiased">
        <OnboardingGate />
        {children}
        <TabBar />
      </body>
    </html>
  );
}
