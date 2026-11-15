import {readStore, useStore, writeStore} from './local-store';

// Same columns as academic_profiles in the DB handoff (user_id is implied by the session there).
export type AcademicProfile = {college_id: string; program_id: string; catalog_year: number};

const KEY = 'digree.profile';

export const useProfile = () => useStore<AcademicProfile | null>(KEY, null);
export const saveProfile = (profile: AcademicProfile) => writeStore(KEY, profile);
export const hasProfile = () => readStore<AcademicProfile | null>(KEY, null) !== null;
