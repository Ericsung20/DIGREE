import {IS_MOCK, supabase} from '../supabase';
import {getRemote, readStore, setRemote, useRemote, useStore, writeStore} from './local-store';

export type TransferCredit = {
  id: string; institution: string; source_course: string; equivalent_course_id: string | null;
  credits: number; awarded_term: string; notes: string;
};
export type TransferDraft = Omit<TransferCredit, 'id'>;
const KEY = 'digree.transfer_credits';
const EMPTY: TransferCredit[] = [];
const COLUMNS = 'id, institution, source_course, equivalent_course_id, credits, awarded_term, notes';

export const useTransferCredits: () => TransferCredit[] = IS_MOCK
  ? () => useStore(KEY, EMPTY)
  : () => useRemote(KEY, EMPTY, async () => {
    const {data, error} = await supabase().from('transfer_credits').select(COLUMNS).order('created_at');
    if (error) throw error;
    return (data as TransferCredit[]).map(row => ({...row, credits: Number(row.credits)}));
  });

export function validateTransfer(draft: TransferDraft, existing: TransferCredit[], id?: string): string | null {
  if (!draft.institution.trim() || draft.institution.trim().length > 160 || !draft.source_course.trim() || draft.source_course.trim().length > 160) return 'Enter the source school and course.';
  if (!Number.isFinite(draft.credits) || draft.credits <= 0 || draft.credits > 30 || Math.abs(Math.round(draft.credits * 100) - draft.credits * 100) > 1e-7) return 'Enter recognized credits between 0.01 and 30, with at most two decimal places.';
  if (!draft.awarded_term || draft.notes.length > 1000) return 'Choose the recognition semester and keep notes under 1,000 characters.';
  if (existing.some(row => row.id !== id && ((row.institution.trim().toLowerCase() === draft.institution.trim().toLowerCase()
    && row.source_course.trim().toLowerCase() === draft.source_course.trim().toLowerCase())
    || (draft.equivalent_course_id && row.equivalent_course_id === draft.equivalent_course_id)))) return 'This transfer course or UW equivalent is already recorded.';
  return null;
}

export async function saveTransferCredit(draft: TransferDraft, id?: string): Promise<void> {
  const existing = IS_MOCK ? readStore(KEY, EMPTY) : getRemote(KEY, EMPTY);
  const error = validateTransfer(draft, existing, id);
  if (error) throw new Error(error);
  const row = {...draft, institution: draft.institution.trim(), source_course: draft.source_course.trim()};
  let saved: TransferCredit;
  if (IS_MOCK) saved = {...row, id: id ?? crypto.randomUUID()};
  else {
    const db = supabase();
    const {data: auth} = await db.auth.getUser();
    if (!auth.user) throw new Error('Sign in to save transfer credit.');
    const query = id ? db.from('transfer_credits').update(row).eq('id', id) : db.from('transfer_credits').insert(row);
    const {data, error} = await query.select(COLUMNS).single();
    if (error?.code === '23505') throw new Error('This transfer course or UW equivalent is already recorded.');
    if (error) throw error;
    saved = {...data, credits: Number(data.credits)} as TransferCredit;
  }
  const next = [...existing.filter(item => item.id !== saved.id), saved];
  if (IS_MOCK) writeStore(KEY, next); else setRemote(KEY, next);
}

export async function removeTransferCredit(id: string): Promise<void> {
  if (!IS_MOCK) {
    const {error} = await supabase().from('transfer_credits').delete().eq('id', id);
    if (error) throw error;
  }
  const next = (IS_MOCK ? readStore(KEY, EMPTY) : getRemote(KEY, EMPTY)).filter(row => row.id !== id);
  if (IS_MOCK) writeStore(KEY, next); else setRemote(KEY, next);
}

/** Exact non-repeatable UW equivalents earn credit once across both sources. */
export function countedTransferCredits(transfers: TransferCredit[], earnedCourseIds: ReadonlySet<string>, repeatableCourseIds: ReadonlySet<string> = new Set()): TransferCredit[] {
  return transfers.filter(row => !row.equivalent_course_id || repeatableCourseIds.has(row.equivalent_course_id) || !earnedCourseIds.has(row.equivalent_course_id));
}
