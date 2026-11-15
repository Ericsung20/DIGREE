import {IS_MOCK, supabase} from '../supabase';
import {getRemote, readStore, setRemote, useRemote, useStore, writeStore} from './local-store';

type Item = {requirement_id: string; credits_remaining: number};
const EMPTY: Item[] = [];
const key = (programId: string) => `dars-progress:${programId}`;
const PREFIX = 'dars:';
export const useDarsProgress: (programId: string) => Item[] = IS_MOCK
  ? (programId) => useStore(key(programId), EMPTY)
  : (programId) => useRemote(key(programId), EMPTY, async () => {
    if (!programId) return EMPTY;
    const {data, error} = await supabase().from('degree_progress')
      .select('requirement_id, credits_remaining').eq('program_id', programId).eq('source', 'dars_pdf').like('requirement_id', `${PREFIX}%`).order('requirement_id');
    if (error) throw error;
    return data.filter((item) => item.credits_remaining !== null).map((item) => ({...item, requirement_id: item.requirement_id.slice(PREFIX.length)}));
  });

function update(programId: string, change: (items: Item[]) => Item[]) {
  const cache = key(programId);
  if (IS_MOCK) writeStore(cache, change(readStore(cache, EMPTY)));
  else setRemote(cache, change(getRemote(cache, EMPTY)));
}

export async function saveDarsProgress(programId: string, item: Item): Promise<string | null> {
  const requirement = item.requirement_id.trim();
  if (!programId || !requirement || requirement.length > 120 || !Number.isInteger(item.credits_remaining) || item.credits_remaining < 0 || item.credits_remaining > 200) {
    return 'Enter a requirement and remaining credits between 0 and 200.';
  }
  const value = {...item, requirement_id: requirement};
  if (!IS_MOCK) {
    const db = supabase();
    const {data: auth} = await db.auth.getUser();
    if (!auth.user) return 'Sign in to save degree progress.';
    const {error} = await db.from('degree_progress').upsert({
      ...value, requirement_id: PREFIX + requirement, user_id: auth.user.id, program_id: programId, source: 'dars_pdf', review_status: 'dars_pdf',
    });
    if (error) return error.message;
  }
  update(programId, (items) => [...items.filter((existing) => existing.requirement_id !== requirement), value]
    .sort((a, b) => a.requirement_id.localeCompare(b.requirement_id)));
  return null;
}

export async function removeDarsProgress(programId: string, requirement: string): Promise<string | null> {
  if (!IS_MOCK) {
    const {error} = await supabase().from('degree_progress').delete()
      .eq('program_id', programId).eq('requirement_id', PREFIX + requirement).eq('source', 'dars_pdf');
    if (error) return error.message;
  }
  update(programId, (items) => items.filter((item) => item.requirement_id !== requirement));
  return null;
}
