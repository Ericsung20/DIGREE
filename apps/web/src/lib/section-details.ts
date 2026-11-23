export type SectionDetail = {
  type: string; section: string; day: string; start_min: number; end_min: number;
  building_id: string | null; building: string | null; room: string | null; instructors: string[];
};
type RawMeeting = {meetingType?: string; meetingDays?: string; meetingTimeStart?: number; meetingTimeEnd?: number; room?: string; building?: {buildingCode?: string; buildingName?: string}};
type RawSection = {type?: string; sectionNumber?: string; instructors?: {name?: string | {first?: string; middle?: string; last?: string}}[]; classMeetings?: RawMeeting[]};
export type RawPackage = {docId?: string; sections?: RawSection[]};
const DAYS: Record<string, string> = {M: 'MON', T: 'TUE', W: 'WED', R: 'THU', F: 'FRI', S: 'SAT', U: 'SUN'};
export const sectionType = (type: string) => ({LEC: 'Lecture', DIS: 'Discussion', LAB: 'Lab', SEM: 'Seminar', IND: 'Independent study', FLD: 'Field study', STU: 'Studio'}[type] ?? type);
export function normalizeSectionDetails(pack: RawPackage): SectionDetail[] {
  const rows: SectionDetail[] = [];
  for (const section of pack.sections ?? []) {
    const instructors = (section.instructors ?? []).flatMap(item => {
      const name = typeof item.name === 'string' ? item.name.trim() : [item.name?.first, item.name?.middle, item.name?.last].filter(Boolean).join(' ');
      return name ? [name] : [];
    });
    for (const meeting of section.classMeetings ?? []) {
      if (meeting.meetingType !== 'CLASS' || !Number.isInteger(meeting.meetingTimeStart) || !Number.isInteger(meeting.meetingTimeEnd)) continue;
      const start_min = ((meeting.meetingTimeStart! / 60000 - 360) % 1440 + 1440) % 1440;
      const end_min = ((meeting.meetingTimeEnd! / 60000 - 360) % 1440 + 1440) % 1440 || 1440;
      if (!Number.isInteger(start_min) || !Number.isInteger(end_min) || end_min <= start_min) continue;
      for (const day of meeting.meetingDays ?? '') if (DAYS[day]) rows.push({
        type: section.type ?? 'Class', section: section.sectionNumber ?? '', day: DAYS[day], start_min, end_min,
        building_id: meeting.building?.buildingCode ? `uw-${meeting.building.buildingCode}` : null,
        building: meeting.building?.buildingName ?? null, room: meeting.room?.trim() || null, instructors,
      });
    }
  }
  return rows;
}
