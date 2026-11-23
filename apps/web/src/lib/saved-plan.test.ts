import {beforeEach, expect, test, vi} from 'vitest';
import {getRemote, resetRemote} from './data/local-store';
import {readScheduleItems, savePlannedSchedule} from './data/saved-schedules';

const db = vi.hoisted(() => ({auth: {getUser: vi.fn()}, rpc: vi.fn()}));
vi.mock('./supabase', () => ({IS_MOCK: false, supabase: () => db}));

const selected = [{course_id: 'course', course_code: 'CS 400', bundle_id: 'section-B', credits: 4, meetings: []}];
beforeEach(() => {
  resetRemote();
  db.auth.getUser.mockResolvedValue({data: {user: {id: 'owner'}}});
  db.rpc.mockReset();
});

test('a confirmed save populates the selected semester with the displayed section', async () => {
  db.rpc.mockResolvedValue({data: 'saved-id', error: null});
  await savePlannedSchedule({term: '1274', selected}, 'request');
  expect(db.rpc).toHaveBeenCalledWith('save_schedule', {p_term: '1274', p_items: [{course_id: 'course', bundle_id: 'section-B', credits: 4}], p_request_id: 'request'});
  expect(getRemote('digree.planned:1274:state', null)).toEqual({plan: {id: 'saved-id', term: '1274', selected}, loading: false, error: null});
  expect(getRemote('digree.planned:1272:state', null)).toBeNull();
});

test.each([
  {data: null, error: new Error('Save failed')},
  {data: null, error: null},
])('failed or unconfirmed saves do not claim a persisted plan: %j', async response => {
  db.rpc.mockResolvedValue(response);
  await expect(savePlannedSchedule({term: '1274', selected}, 'request')).rejects.toThrow();
  expect(getRemote('digree.planned:1274:state', null)).toBeNull();
});

test('database reload reconstructs saved course credits and section meetings', () => {
  const meetings = [{day: 'MON', start_min: 540, end_min: 590, mode: 'in_person', building_id: 'hall'}];
  expect(readScheduleItems([{course_id: 'course', bundle_id: 'section-B', credits: 4, section_bundles: {courses: {code: 'COMP SCI 400'}, meetings}}])).toEqual([
    {course_id: 'course', course_code: 'COMP SCI 400', bundle_id: 'section-B', credits: 4, meetings},
  ]);
});
