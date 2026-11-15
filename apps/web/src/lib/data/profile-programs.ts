import {IS_MOCK, supabase} from '../supabase';
import {getRemote, readStore, setRemote, useRemote, useStore, writeStore} from './local-store';

export type SupplementalKind = 'certificate' | 'minor';
export type SupplementalProgram = {
  kind: SupplementalKind; program_key: string; name: string; catalog_year: number; source_url?: string;
};

export type ProfileProgramDraft =
  | {kind: 'major'; program_id: string; name: null; catalog_year: null}
  | {kind: SupplementalKind; program_id: null; name: string; catalog_year: number; supplemental_program_key: string};
type ProfileProgram = {
  id: string;
  kind: ProfileProgramDraft['kind'];
  program_id: string | null;
  name: string | null;
  catalog_year: number | null;
  supplemental_program_key?: string | null;
};

const KEY = 'digree.profile.programs';
export const MAX_ADDITIONAL_MAJORS = 2;
export const MAJOR_LIMIT_MESSAGE = 'You can save up to 3 majors, including your primary major.';
const EMPTY: ProfileProgram[] = [];
const COLUMNS = 'id, kind, program_id, name, catalog_year, supplemental_program_key';
const CATALOG_KEY = 'digree.supplemental.catalog';
const LOADING_CATALOG = {ready: false, available: true, programs: [] as SupplementalProgram[]};
const DEMO_CATALOG: typeof LOADING_CATALOG = {ready: true, available: true, programs: [
  {kind: 'certificate', program_key: 'demo-data', name: 'Demo Data Science Certificate', catalog_year: 2025},
  {kind: 'certificate', program_key: 'demo-data', name: 'Demo Data Science Certificate', catalog_year: 2026},
  {kind: 'minor', program_key: 'demo-music', name: 'Demo Music Minor', catalog_year: 2026},
]};

async function fetchSupplementalCatalog(): Promise<typeof LOADING_CATALOG> {
  const programs: SupplementalProgram[] = [];
  const pageSize = 500;
  for (let start = 0; ; start += pageSize) {
    const {data, error} = await supabase().from('supplemental_program_catalog')
      .select('kind, program_key, name, catalog_year, source_url').order('catalog_year', {ascending: false})
      .order('program_key').range(start, start + pageSize - 1);
    if (error) return {ready: true, available: false, programs: []};
    programs.push(...data as SupplementalProgram[]);
    if (data.length < pageSize) return {ready: true, available: true, programs};
  }
}

export const useSupplementalCatalog = IS_MOCK
  ? () => DEMO_CATALOG
  : () => useRemote(CATALOG_KEY, LOADING_CATALOG, fetchSupplementalCatalog);

async function fetchPrograms(): Promise<ProfileProgram[]> {
  const {data, error} = await supabase().from('academic_profile_programs').select(COLUMNS).order('id');
  if (error?.code === 'PGRST205' || error?.code === '42703') return EMPTY;
  if (error) throw error;
  return data as ProfileProgram[];
}

export const useProfilePrograms = IS_MOCK ? () => useStore(KEY, EMPTY) : () => useRemote(KEY, EMPTY, fetchPrograms);

export async function addProfileProgram(draft: ProfileProgramDraft) {
  if (IS_MOCK) {
    const entries = readStore(KEY, EMPTY);
    if (draft.kind === 'major' && entries.filter((entry) => entry.kind === 'major').length >= MAX_ADDITIONAL_MAJORS) {
      throw new Error(MAJOR_LIMIT_MESSAGE);
    }
    if (entries.some((entry) => draft.kind === 'major'
      ? entry.program_id === draft.program_id
      : entry.supplemental_program_key === draft.supplemental_program_key)) {
      throw new Error('This program is already in your profile.');
    }
    writeStore(KEY, [...entries, {...draft, id: crypto.randomUUID()}]);
    return;
  }
  const db = supabase();
  const {data: auth} = await db.auth.getUser();
  if (!auth.user) throw new Error('Sign in to save a program.');
  const {data, error} = await db.from('academic_profile_programs')
    .insert({...draft, user_id: auth.user.id}).select(COLUMNS).single();
  if (error?.message === MAJOR_LIMIT_MESSAGE || (error?.code === '23505' && error.message.includes('academic_profile_major_slot_unique'))) {
    throw new Error(MAJOR_LIMIT_MESSAGE);
  }
  if (error?.code === '23505') throw new Error('This program is already in your profile.');
  if (error && ['PGRST205', 'PGRST204', '42703'].includes(error.code)) throw new Error('Saving additional programs is temporarily unavailable.');
  if (error) throw error;
  const programs = getRemote(KEY, EMPTY);
  setRemote(KEY, [...programs, data as ProfileProgram]);
}

export async function removeProfileProgram(id: string) {
  if (IS_MOCK) {
    writeStore(KEY, readStore(KEY, EMPTY).filter((program) => program.id !== id));
    return;
  }
  const {error} = await supabase().from('academic_profile_programs').delete().eq('id', id);
  if (error) throw error;
  setRemote(KEY, getRemote(KEY, EMPTY).filter((program) => program.id !== id));
}
