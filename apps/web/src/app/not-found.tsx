import Link from 'next/link';
import {EmptyState, Screen, primary} from '@/components/screen';

export default function NotFound() {
  return (
    <Screen title="Page not found" home>
      <EmptyState title="Page not found" body="Check the address or return to your schedule." />
      <Link href="/" className={primary}>Back to schedule</Link>
    </Screen>
  );
}
