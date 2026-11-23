'use client';
import {useEffect, useId, useRef, type ReactNode} from 'react';
import {ICON, Svg} from './dg';
import {s} from '@/lib/ui/css';

/** Native modal top layer keeps focus and Escape handling above page navigation. */
export function Sheet({title, badge, onDismiss, children}: {title: string; badge?: ReactNode; onDismiss: () => void; children: ReactNode}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);
  return <>
    <style>{'.dg-sheet::backdrop{background:rgba(29,27,26,.42)}'}</style>
    <dialog ref={dialog} className="dg-sheet" aria-labelledby={titleId} onCancel={event => {event.preventDefault(); onDismiss();}} onClick={event => {if (event.target === event.currentTarget) onDismiss();}} style={s('width: min(390px, 100vw); max-height: 88dvh; margin: auto auto 0; box-sizing: border-box; border: none; border-radius: 28px 28px 0 0; padding: 20px 20px 28px; background: #FFFFFF; color: #1D1B1A; font-family: Nunito, system-ui, sans-serif; font-variant-numeric: tabular-nums; box-shadow: 0 16px 64px #0004')}>
      <div style={s('display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; margin-bottom: 16px')}>
        <div style={s('display: grid; gap: 6px')}>{badge}<h2 id={titleId} style={s('margin: 0; font-size: 22px; font-weight: 900; line-height: 1.2')}>{title}</h2></div>
        <button type="button" aria-label="Close dialog" onClick={onDismiss} style={s('flex-shrink: 0; width: 40px; height: 40px; border: none; border-radius: 20px; background: #F1EEEA; color: #1D1B1A; display: flex; align-items: center; justify-content: center; cursor: pointer')}><Svg size={18} sw={2.6}>{ICON.x}</Svg></button>
      </div>
      {children}
    </dialog>
  </>;
}
