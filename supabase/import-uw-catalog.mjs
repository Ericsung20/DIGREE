import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
const runFile = promisify(execFile);
import { setTimeout as delay } from 'node:timers/promises';

const enroll = 'https://public.enroll.wisc.edu/api/search/v1';
const grades = 'https://madenroll.com/api/grades/courses/';
const [, , termCode = '1274', ...codes] = process.argv;
const requested = new Set(codes.length ? codes : ['COMP SCI 300', 'COMP SCI 577', 'MATH 221', 'STAT 301']);
const dayCodes = { M: 'MON', T: 'TUE', W: 'WED', R: 'THU', F: 'FRI', S: 'SAT', U: 'SUN' };
const seatStatuses = { OPEN: 'open', CLOSED: 'full', WAITLISTED: 'full' };

async function getJson(url, body, optional = false) {
  if (process.platform === 'win32' && url.startsWith(enroll)) {
    const { stdout } = await runFile('powershell.exe', ['-NoProfile', '-Command', `
      $ErrorActionPreference = 'Stop'
      [Console]::OutputEncoding = [Text.UTF8Encoding]::new()
      $params = @{ Uri = $env:DIGREE_CATALOG_URL; UseBasicParsing = $true; TimeoutSec = 30 }
      if ($env:DIGREE_CATALOG_BODY) {
          $params.Method = 'Post'
          $params.ContentType = 'application/json'
          $params.Body = $env:DIGREE_CATALOG_BODY
      }
      (Invoke-WebRequest @params).Content
    `], {
      env: { ...process.env, DIGREE_CATALOG_URL: url, DIGREE_CATALOG_BODY: body ? JSON.stringify(body) : '' },
      encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, timeout: 35000,
    });
    return JSON.parse(stdout);
  }
  const response = await fetch(url, {
    ...(body && { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(30000),
  });
  if (optional && [404, 409].includes(response.status)) {
    console.error('No unambiguous grade distribution at ' + url + ' (HTTP ' + response.status + ')');
    return null;
  }
  if (!response.ok) throw new Error('HTTP ' + response.status + ' from ' + url);
  return response.json();
}

// The public search serializes campus wall clock using a fixed six-hour offset.
function campusMinute(milliseconds, end = false) {
  if (!Number.isInteger(milliseconds) || milliseconds % 60000 !== 0) return null;
  const minute = ((milliseconds / 60000 - 360) % 1440 + 1440) % 1440;
  return end && minute === 0 ? 1440 : minute;
}

function instructorName(name) {
  if (typeof name === 'string') return name.trim();
  return [name?.first, name?.middle, name?.last]
    .filter((part) => typeof part === 'string' && part.trim())
    .map((part) => part.trim())
    .join(' ');
}

function normalizePackage(pack, course, buildings) {
  if (pack.published !== true || !pack.docId || !pack.sections?.length) return null;
  const meetings = new Map();
  const instructors = new Set();
  const sections = [];
  for (const section of pack.sections) {
    if (section.type && section.sectionNumber) sections.push(`${section.type} ${section.sectionNumber}`);
    for (const instructor of section.instructors ?? []) {
      const name = instructorName(instructor?.name);
      if (name) instructors.add(name);
    }
    const classes = (section.classMeetings ?? []).filter(meeting => meeting.meetingType === 'CLASS');
    const mode = section.instructionMode ?? '';
    if (/asynchronous/i.test(mode) && !classes.some(row => row.meetingTimeStart != null)) continue;
    const normalizedMode = mode === 'Classroom Instruction' ? 'in_person'
      : /hybrid/i.test(mode) ? 'hybrid' : /online/i.test(mode) ? 'online_sync' : null;
    if (!normalizedMode || !classes.length) return null;

    for (const row of classes) {
      const start_min = campusMinute(row.meetingTimeStart);
      const end_min = campusMinute(row.meetingTimeEnd, true);
      const days = [...(row.meetingDays ?? '')].map(day => dayCodes[day]);
      if (!days.length || days.includes(undefined) || start_min === null || end_min === null || end_min <= start_min) {
        return null;
      }
      const building_id = row.building?.buildingCode ? 'uw-' + row.building.buildingCode : null;
      if (building_id) buildings.set(building_id, { id: building_id, name: row.building.buildingName ?? null });
      for (const day of days) {
        const meeting = { day, start_min, end_min, mode: normalizedMode, building_id };
        meetings.set(JSON.stringify(meeting), meeting);
      }
    }
  }
  return {
    term: termCode, course_id: course.id, bundle_id: pack.docId,
    seat_status: seatStatuses[pack.packageEnrollmentStatus?.status] ?? 'unknown',
    section_label: sections.join(' + ') || null,
    instructors: [...instructors],
    meetings: [...meetings.values()],
  };
}

async function gradeStats(hit, id, fetched_at) {
  const identifier = hit.subject.shortDescription.replace(/\s/g, '') + '_' + hit.catalogNumber;
  const url = grades + encodeURIComponent(identifier);
  const data = await getJson(url, undefined, true);
  if (!data) return null;
  if (String(data.course?.number) !== String(hit.catalogNumber)
      || !data.course?.subjects?.some(subject => String(subject.subjectId) === hit.subject.subjectCode)) {
    console.error('Grade identity did not match ' + hit.courseDesignation);
    return null;
  }
  const sample_size = data.cumulative?.letterGradeCount;
  const a = data.cumulative?.counts?.aCount;
  const ab = data.cumulative?.counts?.abCount;
  if (![sample_size, a, ab].every(number => Number.isInteger(number) && number >= 0)
      || a + ab > sample_size || !data.coverage?.firstTermCode || !data.coverage?.lastTermCode) {
    throw new Error('Invalid grade distribution at ' + url);
  }
  return sample_size ? {
    course_id: id, sample_size, a_ab_count: a + ab, source_url: url,
    first_term_code: String(data.coverage.firstTermCode),
    last_term_code: String(data.coverage.lastTermCode), fetched_at,
  } : null;
}

async function collect() {
  const term = (await getJson(enroll + '/terms')).find(term => term.termCode === termCode);
  if (!term) throw new Error('Term is absent from public search: ' + termCode);
  const hits = new Map();
  const pageSize = 500;
  for (let page = 1; ; page++) {
    const result = await getJson(enroll, {
      selectedTerm: termCode, queryString: '*', filters: [], page, pageSize, sortOrder: 'SUBJECT',
    });
    for (const hit of result.hits) {
      if (requested.has(hit.courseDesignation)) hits.set(hit.courseDesignation, hit);
    }
    if (hits.size === requested.size || page * pageSize >= result.found || !result.hits.length) break;
    await delay(150);
  }
  const missing = [...requested].filter(code => !hits.has(code));
  if (missing.length) throw new Error('No exact catalog match: ' + missing.join(', '));

  const fetched_at = new Date().toISOString();
  const courses = [], packages = [], stats = [], buildings = new Map();
  for (const hit of hits.values()) {
    const { minimumCredits: min, maximumCredits: max } = hit;
    if (!Number.isInteger(min) || !Number.isInteger(max) || min < 1 || min > max || max > 30
        || !['Y', 'N'].includes(hit.repeatable) || !/^\d+$/.test(hit.courseId) || !/^\d+$/.test(hit.subject.subjectCode)) {
      throw new Error('Unsupported catalog values for ' + hit.courseDesignation);
    }
    const course = {
      id: 'uw-' + hit.courseId, code: hit.courseDesignation, title: hit.title ?? null,
      credit_options: Array.from({ length: max - min + 1 }, (_, i) => min + i),
      breadth: hit.breadths?.map(breadth => breadth.code).filter(Boolean) ?? null,
      repeatable: hit.repeatable === 'Y', source: 'uw_public_course_search', fetched_at,
    };
    if (courses.some(existing => existing.id === course.id)) throw new Error('Use one code per cross-listed course');
    const url = enroll + '/enrollmentPackages/' + termCode + '/' + hit.subject.subjectCode + '/' + hit.courseId;
    const sourcePackages = await getJson(url);
    const normalized = sourcePackages.map(pack => normalizePackage(pack, course, buildings)).filter(Boolean);
    if (normalized.length < sourcePackages.length) {
      console.error(course.code + ': skipped ' + (sourcePackages.length - normalized.length) + ' unpublished or unrepresentable packages');
    }
    const grades = await gradeStats(hit, course.id, fetched_at);
    courses.push(course);
    packages.push(...normalized);
    if (grades) stats.push(grades);
    console.error(course.code + ': ' + normalized.length + ' bundles, ' + (grades?.sample_size ?? 'no') + ' letter grades');
    await delay(150);
  }
  return { term: { id: termCode, label: term.longDescription }, courses, packages, stats, buildings: [...buildings.values()] };
}

function asSql(data) {
  const json = JSON.stringify(data).replaceAll("'", "''");
  return `begin;
set local standard_conforming_strings = on;
create temp table catalog_import (payload jsonb) on commit drop;
insert into catalog_import values ('${json}'::jsonb);

insert into public.terms (id, label)
select payload->'term'->>'id',
    regexp_replace(regexp_replace(payload->'term'->>'label', '^(Fall) ([0-9]{4})-[0-9]{4}$', '\\1 \\2'), '^(Spring|Summer) [0-9]{4}-([0-9]{4})$', '\\1 \\2')
from catalog_import
on conflict (id) do update set label = excluded.label;

insert into public.courses (id, code, title, credit_options, breadth, repeatable, source, fetched_at)
select row.id, row.code, row.title, row.credit_options, row.breadth, row.repeatable, row.source, row.fetched_at
from catalog_import cross join lateral jsonb_populate_recordset(null::public.courses, payload->'courses') as row
on conflict (id) do update set code = excluded.code, title = excluded.title,
    credit_options = excluded.credit_options, breadth = excluded.breadth,
    repeatable = excluded.repeatable, source = excluded.source, fetched_at = excluded.fetched_at;

insert into public.buildings (id, name)
select row.id, row.name from catalog_import
cross join lateral jsonb_populate_recordset(null::public.buildings, payload->'buildings') as row
on conflict (id) do update set name = coalesce(excluded.name, buildings.name);

create temp table catalog_packages on commit drop as
select row.* from catalog_import cross join lateral jsonb_to_recordset(payload->'packages')
    as row(term text, course_id text, bundle_id text, seat_status public.seat_status, section_label text, instructors text[], meetings jsonb);

insert into public.section_bundles (term, course_id, bundle_id, seat_status, section_label, instructors)
select term, course_id, bundle_id, seat_status, section_label, coalesce(instructors, '{}') from catalog_packages
on conflict (term, course_id, bundle_id) do update set seat_status = excluded.seat_status,
    section_label = coalesce(excluded.section_label, section_bundles.section_label),
    instructors = case when cardinality(excluded.instructors) > 0 then excluded.instructors else section_bundles.instructors end;

delete from public.meetings as meeting using catalog_packages as package
where (meeting.term, meeting.course_id, meeting.bundle_id) = (package.term, package.course_id, package.bundle_id);

insert into public.meetings (term, course_id, bundle_id, day, start_min, end_min, mode, building_id)
select package.term, package.course_id, package.bundle_id, row.day, row.start_min, row.end_min, row.mode, row.building_id
from catalog_packages as package cross join lateral
    jsonb_populate_recordset(null::public.meetings, package.meetings) as row;

insert into public.course_grade_stats (course_id, a_ab_count, sample_size, source_url, first_term_code, last_term_code, fetched_at)
select row.course_id, row.a_ab_count, row.sample_size, row.source_url, row.first_term_code, row.last_term_code, row.fetched_at
from catalog_import cross join lateral jsonb_populate_recordset(null::public.course_grade_stats, payload->'stats') as row
on conflict (course_id) do update set a_ab_count = excluded.a_ab_count, sample_size = excluded.sample_size,
    source_url = excluded.source_url, first_term_code = excluded.first_term_code,
    last_term_code = excluded.last_term_code, fetched_at = excluded.fetched_at;

insert into public.chat_rooms (term, course_id)
select distinct term, course_id from catalog_packages on conflict do nothing;
commit;`;
}
export { asSql, getJson, normalizePackage, gradeStats, enroll };

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) try {
  if (!/^\d{4}$/.test(termCode)) throw new Error('Expected a four-digit UW term code');
  console.log(asSql(await collect()));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
