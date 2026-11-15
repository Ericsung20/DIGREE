import Link from 'next/link';
import {Frame, Wordmark} from '@/components/dg';
import {s} from '@/lib/ui/css';

const CSS = `
a{color:#8C1D2B}a:hover{color:#6F1622}
`;

export default function NotFound() {
  return (
    <Frame css={CSS} extra="padding: 0 24px 28px">
      <div style={s('flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 14px; text-align: center')}>
        <Wordmark style="font-size: 44px; font-weight: 900; letter-spacing: -0.03em; line-height: 1" />
        <p style={s('margin: 0; max-width: 280px; font-size: 16px; font-weight: 600; line-height: 1.5; color: #5F5A55')}>Nothing to dig up at this address.</p>
      </div>
      <Link href="/" style={s('height: 58px; border-radius: 22px; background: #8C1D2B; color: #FFFFFF; text-decoration: none; display: flex; align-items: center; justify-content: center; font-size: 18px; font-weight: 900; box-shadow: 0 8px 20px rgba(140,29,43,0.30)')}>Back to Schedule</Link>
    </Frame>
  );
}
