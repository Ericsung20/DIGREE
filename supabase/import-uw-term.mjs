import { mkdir, writeFile, readFile, rename } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { asSql, getJson, normalizePackage, gradeStats, enroll } from './import-uw-catalog.mjs';

const [, , termCode = '1274', phase = 'catalog'] = process.argv;
if (!/^\d{4}$/.test(termCode) || !['catalog', 'detail', 'sections'].includes(phase)) {
  throw new Error('Usage: node supabase/import-uw-term.mjs TERM catalog|detail|sections');
}
const directory = resolve(import.meta.dirname, '.temp', 'uw-' + termCode);
const manifestPath = join(directory, 'manifest.json');
await mkdir(directory, { recursive: true });
const fetched_at = new Date().toISOString();

async function writeAtomic(path, contents) {
  await writeFile(path + '.tmp', contents, 'utf8');
  await rename(path + '.tmp', path);
}

async function readIfPresent(path) {
  try { return await readFile(path, 'utf8'); }
  catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

async function catalog() {
  const term = (await getJson(enroll + '/terms')).find(row => row.termCode === termCode);
  if (!term) throw new Error('Term is absent from UW public search: ' + termCode);
  const rows = [];
  const pageSize = 500;
  for (let page = 1; ; page++) {
    const result = await getJson(enroll, {
      selectedTerm: termCode, queryString: '*', filters: [], page, pageSize, sortOrder: 'SUBJECT',
    });
    if (!result.hits.length && rows.length < result.found) throw new Error('Incomplete UW search response');
    rows.push(...result.hits);
    if (rows.length >= result.found) break;
    await delay(200);
  }

  const entries = new Map();
  const codes = new Set();
  let topics = 0, duplicates = 0, unsupported = 0;
  const pilotCodes = new Set(['COMP SCI 300', 'COMP SCI 577', 'MATH 221', 'STAT 301']);
  rows.sort((a, b) => Number(pilotCodes.has(b.courseDesignation)) - Number(pilotCodes.has(a.courseDesignation))
    || a.courseDesignation.localeCompare(b.courseDesignation)
    || a.courseId.localeCompare(b.courseId));
  for (const hit of rows) {
    const { courseId, courseDesignation: code, minimumCredits: min, maximumCredits: max } = hit;
    if (courseId.includes('.')) { topics++; continue; }
    if (!code || !/^\d+$/.test(courseId) || !/^\d+$/.test(hit.subject?.subjectCode)
        || !Number.isInteger(min) || !Number.isInteger(max) || min < 1 || min > max || max > 30
        || !['Y', 'N'].includes(hit.repeatable)) { unsupported++; continue; }
    if (entries.has(courseId) || codes.has(code)) { duplicates++; continue; }
    const course = {
      id: 'uw-' + courseId, code, title: hit.title ?? null,
      credit_options: Array.from({ length: max - min + 1 }, (_, i) => min + i),
      breadth: hit.breadths?.map(row => row.code).filter(Boolean) ?? null,
      repeatable: hit.repeatable === 'Y', source: 'uw_public_course_search', fetched_at,
    };
    entries.set(courseId, { course, courseId, subject: hit.subject, catalogNumber: hit.catalogNumber, courseDesignation: code });
    codes.add(code);
  }
  const manifest = { term: { id: termCode, label: term.longDescription }, entries: [...entries.values()] };
  await writeAtomic(manifestPath, JSON.stringify(manifest));
  const batchSize = 800;
  for (let offset = 0; offset < manifest.entries.length; offset += batchSize) {
    const courses = manifest.entries.slice(offset, offset + batchSize).map(entry => entry.course);
    const number = String(offset / batchSize + 1).padStart(3, '0');
    await writeAtomic(join(directory, 'catalog-' + number + '.sql'),
      asSql({ term: manifest.term, courses, packages: [], stats: [], buildings: [] }));
  }
  console.log(JSON.stringify({ searchRows: rows.length, courses: entries.size, topics, duplicates, unsupported }));
}

async function details() {
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const batchSize = 50;
  for (let offset = 0; offset < manifest.entries.length; offset += batchSize) {
    const number = String(offset / batchSize + 1).padStart(3, '0');
    const path = join(directory, 'detail-' + number + '.sql');
    if (await readIfPresent(path) !== null) continue;
    const entries = manifest.entries.slice(offset, offset + batchSize);
    const packages = [], stats = [], buildings = new Map(), failed = [];
    let skipped = 0;
    await Promise.all(Array.from({ length: 4 }, (_, index) => (async () => {
      for (const hit of entries.filter((_, position) => position % 4 === index)) {
        const url = enroll + '/enrollmentPackages/' + termCode + '/' + hit.subject.subjectCode + '/' + hit.courseId;
        const [sectionResult, gradeResult] = await Promise.allSettled([
          getJson(url), gradeStats(hit, hit.course.id, fetched_at),
        ]);
        if (sectionResult.status === 'fulfilled') {
          const normalized = sectionResult.value.map(pack => normalizePackage(pack, hit.course, buildings)).filter(Boolean);
          packages.push(...new Map(normalized.map(row => [row.bundle_id, row])).values());
          skipped += sectionResult.value.length - normalized.length;
        } else failed.push({ course: hit.course.code, source: 'sections', error: sectionResult.reason.message });
        if (gradeResult.status === 'fulfilled') {
          if (gradeResult.value) stats.push(gradeResult.value);
        } else failed.push({ course: hit.course.code, source: 'grades', error: gradeResult.reason.message });
        await delay(350);
      }
    })()));
    await writeAtomic(join(directory, 'detail-' + number + '.json'),
      JSON.stringify({ courses: entries.length, bundles: packages.length, gradeStats: stats.length, skipped, failed }));
    await writeAtomic(path, asSql({ term: manifest.term, courses: [], packages, stats, buildings: [...buildings.values()] }));
    console.log('Detail batch ' + number + ': ' + packages.length + ' bundles, ' + stats.length + ' grade stats, ' + failed.length + ' errors');
  }
}

async function sections() {
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const batchSize = 100;
  // Regenerate earlier batches to read the structured instructor names returned by UW.
  const reportVersion = 2;
  for (let offset = 0; offset < manifest.entries.length; offset += batchSize) {
    const number = String(offset / batchSize + 1).padStart(3, '0');
    const path = join(directory, 'sections-' + number + '.sql');
    const reportPath = join(directory, 'sections-' + number + '.json');
    const previous = JSON.parse(await readIfPresent(reportPath) ?? 'null');
    if (previous?.version === reportVersion && previous.failed.length === 0 && await readIfPresent(path) !== null) continue;
    const entries = manifest.entries.slice(offset, offset + batchSize);
    const packages = [], buildings = new Map(), failed = [];
    let skipped = 0;
    await Promise.all(Array.from({length: 8}, (_, index) => (async () => {
      await delay(index * 100);
      for (const hit of entries.filter((_, position) => position % 8 === index)) {
        try {
          const raw = await getJson(enroll + '/enrollmentPackages/' + termCode + '/' + hit.subject.subjectCode + '/' + hit.courseId);
          const normalized = raw.map((pack) => normalizePackage(pack, hit.course, buildings)).filter(Boolean);
          packages.push(...new Map(normalized.map((row) => [row.bundle_id, row])).values());
          skipped += raw.length - normalized.length;
        } catch (error) {
          failed.push({course: hit.course.code, reason: error.code ?? error.name});
        }
        await delay(450);
      }
    })()));
    await writeAtomic(path, asSql({term: manifest.term, courses: [], packages, stats: [], buildings: [...buildings.values()]}));
    await writeAtomic(reportPath, JSON.stringify({version: reportVersion, courses: entries.length, bundles: packages.length, skipped, failed}));
    console.log('Section batch ' + number + ': ' + packages.length + ' bundles, ' + failed.length + ' errors');
  }
}

if (phase === 'catalog') await catalog();
else if (phase === 'sections') await sections();
else await details();
