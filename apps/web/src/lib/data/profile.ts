import {IS_MOCK, supabase} from '../supabase';
import {COLLEGES, PROGRAMS, type College, type Program} from './catalog';
import {getRemote, readStore, setRemote, useRemote, useStore, writeStore} from './local-store';

// Same columns as academic_profiles in the DB handoff (user_id is implied by the session there).
export type AcademicProfile = {college_id: string; program_id: string; catalog_year: number};

export function latestCatalogEdition<T extends {catalog_year: number}>(editions: T[]): T | undefined {
  return editions.reduce<T | undefined>((latest, edition) =>
    !latest || edition.catalog_year > latest.catalog_year ? edition : latest, undefined);
}

const KEY = 'digree.profile';
const COLUMNS = 'college_id, program_id, catalog_year';
const EMPTY_OPTIONS = {colleges: [] as College[], programs: [] as Program[], ready: false};
const DEMO_OPTIONS = {colleges: COLLEGES, programs: PROGRAMS, ready: true};

async function fetchProfile(): Promise<AcademicProfile | null> {
  const {data, error} = await supabase().from('academic_profiles').select(COLUMNS).maybeSingle();
  if (error) throw error;
  return data;
}

export const useProfile: () => AcademicProfile | null = IS_MOCK ? () => useStore(KEY, null) : () => useRemote(KEY, null, fetchProfile);

export async function shouldOnboard(): Promise<boolean> {
  if (IS_MOCK) return readStore<AcademicProfile | null>(KEY, null) === null;
  const cached = getRemote<AcademicProfile | null | undefined>(KEY, undefined);
  const profile = cached === undefined ? await fetchProfile() : cached;
  if (profile) {
    setRemote(KEY, profile);
    return false;
  }
  const options = getRemote('academic_options', EMPTY_OPTIONS);
  if (options.ready) return options.programs.length > 0;
  const available = await fetchOptions();
  setRemote('academic_options', available);
  return available.programs.length > 0;
}

export async function saveProfile(profile: AcademicProfile): Promise<void> {
  if (IS_MOCK) return writeStore(KEY, profile);
  const db = supabase();
  const {data: auth} = await db.auth.getUser();
  if (!auth.user) throw new Error('Sign in to save your profile.');
  const {error} = await db.from('academic_profiles').upsert({user_id: auth.user.id, ...profile});
  if (error) throw error;
  setRemote(KEY, profile);
}

async function fetchOptions(): Promise<typeof EMPTY_OPTIONS> {
  const db = supabase();
  const [colleges, programs] = await Promise.all([
    db.from('colleges').select('id, label').order('label'),
    db.from('academic_programs').select('id, college_id, label, catalog_year').order('label').order('catalog_year'),
  ]);
  if (colleges.error) throw colleges.error;
  if (programs.error) throw programs.error;
  return {colleges: colleges.data, programs: programs.data, ready: true};
}

export const useAcademicOptions = IS_MOCK ? () => DEMO_OPTIONS : () => useRemote('academic_options', EMPTY_OPTIONS, fetchOptions);
