import {IS_MOCK, supabase} from '../supabase';
import {useRemote} from './local-store';
import {useProfile} from './profile';
import {useProfilePrograms} from './profile-programs';

export type RequirementRow = {kind?: string; label?: string; credits?: string | null; credit_conditions?: string[]; references?: unknown[]; courses?: {code: string; published_code?: string}[]};
export type CatalogRequirement = {id: string; program_version_id: string; position: number; heading: string; definition: {rows?: RequirementRow[]}; source_url: string | null};
export type StudentProgram = {program_version_id: string; kind: string; is_primary: boolean; name: string; catalog_year: number; program_id: string | null};
const EMPTY: CatalogRequirement[] = [];
const NO_PROGRAMS: StudentProgram[] = [];

export function useStudentPrograms(): StudentProgram[] {
  const primary = useProfile();
  const additional = useProfilePrograms();
  const key = `${primary?.program_id ?? ''}:${additional.map(row => row.id).sort().join(',')}`;
  return useRemote(`student-programs:${key}`, NO_PROGRAMS, async () => {
    if (IS_MOCK) return [];
    const {data, error} = await supabase().from('student_programs').select('program_version_id, kind, is_primary, name, catalog_year, program_id').order('is_primary', {ascending: false});
    if (error) throw error;
    return data as StudentProgram[];
  });
}

export function useCatalogRequirements(programs: StudentProgram[]): CatalogRequirement[] {
  const ids = programs.map(program => program.program_version_id).sort();
  return useRemote(`catalog-requirements:${ids.join(',')}`, EMPTY, async () => {
    if (IS_MOCK || !ids.length) return [];
    const rows: CatalogRequirement[] = [];
    for (let start = 0; ; start += 500) {
      const {data, error} = await supabase().from('requirement_groups').select('id, program_version_id, position, heading, definition, source_url')
        .in('program_version_id', ids).order('program_version_id').order('position').range(start, start + 499);
      if (error) throw error;
      rows.push(...data as CatalogRequirement[]);
      if (data.length < 500) return rows;
    }
  });
}
