import {currentTermOf, useTerms} from '../data/catalog';
import {useCourseRecords} from '../data/course-records';

/** Course colors from the design: block and tag background, text, and the list dot. */
export type Tone = {bg: string; fg: string; dot: string};
export const TONES: Tone[] = [
  {bg: '#DCE8F7', fg: '#1C3D66', dot: '#9DB8DD'},
  {bg: '#D6EFE8', fg: '#17584A', dot: '#93CBBC'},
  {bg: '#F7E9CF', fg: '#6A4708', dot: '#DDBF85'},
  {bg: '#E7E0F3', fg: '#46356F', dot: '#B9A9D9'},
  {bg: '#E0EED7', fg: '#355A1F', dot: '#A9C7A0'},
  {bg: '#F2D9DD', fg: '#7A2633', dot: '#E0A7B1'},
];
export const NEUTRAL_TONE: Tone = {bg: '#ECE8E3', fg: '#3D3936', dot: '#C9C3BC'};

/** DIG option colors: solid for must-take courses, light with a dashed edge for the ones DIG added. */
export const DIG_TONES = [
  {bg: '#CFE0F5', fg: '#1C3D66', light: '#EAF1FA'},
  {bg: '#C8E9DF', fg: '#17584A', light: '#E6F4EF'},
  {bg: '#F3DFB8', fg: '#7A520C', light: '#FBF1DF'},
  {bg: '#DDD2EF', fg: '#4F3C82', light: '#F1ECF8'},
  {bg: '#D3E8C6', fg: '#3E6A24', light: '#EDF5E7'},
];

export function hashIndex(seed: string, size: number): number {
  return [...seed].reduce((hash, char) => (hash * 31 + char.charCodeAt(0)) >>> 0, 7) % size;
}

/**
 * One color per course, the same on every screen. The courses I am taking this term get distinct
 * tones in the order I added them; any other course falls back to a tone derived from its id.
 */
export function useCourseTone(): (courseId: string | null | undefined) => Tone {
  const records = useCourseRecords();
  const current = currentTermOf(useTerms());
  const mine = records.filter((record) => record.term === current && record.status === 'enrolled_self_reported').map((record) => record.course_id);
  return (courseId) => {
    if (!courseId) return NEUTRAL_TONE;
    const index = mine.indexOf(courseId);
    return TONES[index >= 0 ? index % TONES.length : hashIndex(courseId, TONES.length)];
  };
}

/** Avatar color for a person: a steady tone per id, neutral for someone who shares nothing yet. */
export const personTone = (id: string, sharing = true): Tone => (sharing ? TONES[hashIndex(id, TONES.length)] : NEUTRAL_TONE);
