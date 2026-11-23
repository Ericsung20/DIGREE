import {afterEach, beforeEach, expect, test, vi} from 'vitest';
import {getRemote, resetRemote, setRemote} from './data/local-store';
import {deletePlannedSchedule, freePlanSlot, PlanLimitError, readScheduleItems, refreshPlannedSchedules, savePlannedSchedule} from './data/saved-schedules';

const db = vi.hoisted(() => ({auth: {getUser: vi.fn()}, rpc: vi.fn(), from: vi.fn()}));
vi.mock('./supabase', () => ({IS_MOCK: false, supabase: () => db}));

const selected = [{course_id: 'course', course_code: 'CS 400', bundle_id: 'section-B', credits: 4, meetings: []}];
beforeEach(() => {
  const storage = new Map<string, string>();
  vi.stubGlobal('localStorage', {getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value)});
  resetRemote();
  db.auth.getUser.mockResolvedValue({data: {user: {id: 'owner'}}});
  db.rpc.mockReset();
  db.from.mockReset();
});
afterEach(() => vi.unstubAllGlobals());

test('a confirmed save populates the selected semester with the displayed section', async () => {
  db.rpc.mockResolvedValue({data: 'saved-id', error: null});
  await savePlannedSchedule({term: '1274', selected}, 'request');
  expect(db.rpc).toHaveBeenCalledWith('save_schedule', {p_term: '1274', p_items: [{course_id: 'course', bundle_id: 'section-B', credits: 4}], p_request_id: 'request'});
  expect(getRemote('digree.planned:1274:plans', null)).toEqual({plans: [{id: 'saved-id', term: '1274', selected, slot: 1}], loading: false, error: null});
  expect(getRemote('digree.planned:1272:plans', null)).toBeNull();
  expect(JSON.parse(localStorage.getItem('digree.schedule.location')!)).toEqual({term: '1274', view: 'plans', plan: 'saved-id'});
});

test.each([
  {data: null, error: new Error('Save failed')},
  {data: null, error: null},
])('failed or unconfirmed saves do not claim a persisted plan: %j', async response => {
  db.rpc.mockResolvedValue(response);
  await expect(savePlannedSchedule({term: '1274', selected}, 'request')).rejects.toThrow();
  expect(getRemote('digree.planned:1274:plans', null)).toBeNull();
});

test('appending a plan preserves existing plans and fills the available slot', async () => {
  const first = {id: 'first', term: '1274', selected, slot: 1};
  const third = {id: 'third', term: '1274', selected, slot: 3};
  setRemote('digree.planned:1274:plans', {plans: [first, third], loading: false, error: null});
  db.rpc.mockResolvedValue({data: 'second', error: null});
  expect(await savePlannedSchedule({term: '1274', selected}, 'request')).toBe('second');
  expect(getRemote('digree.planned:1274:plans', null)).toMatchObject({plans: [first, {id: 'second', slot: 2}, third]});
  expect(freePlanSlot([{slot: 1}, {slot: 2}, {slot: 3}])).toBeNull();
});

test('server capacity rejection opens the actionable plan-limit path', async () => {
  db.rpc.mockResolvedValue({data: null, error: {message: 'PLANS_FULL: Delete a saved plan before saving another.'}});
  await expect(savePlannedSchedule({term: '1274', selected}, 'request')).rejects.toBeInstanceOf(PlanLimitError);
});

test('deleting a selected plan archives it and preserves other plans', async () => {
  const plans = [1, 2, 3].map(slot => ({id: String(slot), term: '1274', selected, slot}));
  setRemote('digree.planned:1274:plans', {plans, loading: false, error: null});
  db.rpc.mockResolvedValue({data: null, error: null});
  await deletePlannedSchedule(plans[1]);
  expect(db.rpc).toHaveBeenCalledWith('archive_schedule', {p_schedule_id: '2'});
  expect(getRemote('digree.planned:1274:plans', null)).toMatchObject({plans: [plans[0], plans[2]]});
});

test('database reload reconstructs saved course credits and section meetings', () => {
  const meetings = [{day: 'MON', start_min: 540, end_min: 590, mode: 'in_person', building_id: 'hall'}];
  expect(readScheduleItems([{course_id: 'course', bundle_id: 'section-B', credits: 4, section_bundles: {courses: {code: 'COMP SCI 400'}, meetings}}])).toEqual([
    {course_id: 'course', course_code: 'COMP SCI 400', bundle_id: 'section-B', credits: 4, meetings},
  ]);
});

test('refresh loads all active slots and keeps an empty plan available for deletion', async () => {
  const order = vi.fn().mockResolvedValue({data: [
    {id: 'first', term: '1274', plan_slot: 1, saved_schedule_items: [{course_id: 'course', bundle_id: 'section-B', credits: 4, section_bundles: {courses: {code: 'CS 400'}, meetings: []}}]},
    {id: 'third', term: '1274', plan_slot: 3, saved_schedule_items: []},
  ], error: null});
  const query = {select: vi.fn(), eq: vi.fn(), order};
  query.select.mockReturnValue(query); query.eq.mockReturnValue(query);
  db.from.mockReturnValue(query);
  await refreshPlannedSchedules('1274');
  expect(query.eq.mock.calls).toEqual([['user_id', 'owner'], ['term', '1274'], ['mode', 'planned'], ['state', 'active']]);
  expect(order).toHaveBeenCalledWith('plan_slot');
  expect(getRemote('digree.planned:1274:plans', null)).toEqual({plans: [
    {id: 'first', term: '1274', slot: 1, selected}, {id: 'third', term: '1274', slot: 3, selected: []},
  ], loading: false, error: null});
});

test('a read started before saving cannot overwrite the newly saved plans', async () => {
  let finishOld!: (result: unknown) => void;
  const oldRead = new Promise(resolve => {finishOld = resolve;});
  const order = vi.fn().mockReturnValueOnce(oldRead).mockResolvedValueOnce({data: [{id: 'new', term: '1274', plan_slot: 1, saved_schedule_items: []}], error: null});
  const query = {select: vi.fn(), eq: vi.fn(), order};
  query.select.mockReturnValue(query); query.eq.mockReturnValue(query); db.from.mockReturnValue(query);
  const refreshing = refreshPlannedSchedules('1274');
  await vi.waitFor(() => expect(order).toHaveBeenCalledTimes(1));
  db.rpc.mockResolvedValue({data: 'new', error: null});
  await savePlannedSchedule({term: '1274', selected}, 'new-request');
  finishOld({data: [], error: null});
  await refreshing;
  expect(getRemote('digree.planned:1274:plans', null)).toMatchObject({plans: [{id: 'new', slot: 1}]});
});
