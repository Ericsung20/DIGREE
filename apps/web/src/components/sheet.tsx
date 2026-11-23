'use client';
import {useEffect, useId, useRef, type ReactNode} from 'react';
import {s} from '@/lib/ui/css';

/** Native modal top layer keeps focus and Escape handling above page navigation. */
export function Sheet({title, onDismiss, children}: {title: string; onDismiss: () => void; children: ReactNode}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);
  return <>
    <style>{'.dg-sheet::backdrop{background:rgba(29,27,26,.42)}'}</style>
    <dialog ref={dialog} className="dg-sheet" aria-labelledby={titleId} onCancel={event => {event.preventDefault(); onDismiss();}} onClick={event => {if (event.target === event.currentTarget) onDismiss();}} style={s('width: min(390px, calc(100vw - 24px)); max-height: 82dvh; box-sizing: border-box; border: none; border-radius: 24px; padding: 20px; background: #FFFFFF; color: #1D1B1A; box-shadow: 0 16px 64px #0004')}>
      <div style={s('display: flex; justify-content: space-between; align-items: center; gap: 12px; margin-bottom: 16px')}>
        <h2 id={titleId} style={s('margin: 0; font-size: 22px')}>{title}</h2>
        <button type="button" aria-label="Close dialog" onClick={onDismiss} style={s('min-width: 44px; min-height: 44px; border: none; border-radius: 22px; background: #F1EEEA; font: inherit; font-weight: 800; cursor: pointer')}>✕</button>
      </div>
      {children}
    </dialog>
  </>;
}
