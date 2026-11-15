import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { enroll, getJson } from './import-uw-catalog.mjs';

const [, , phase, term, router = 'http://127.0.0.1:18002'] = process.argv;
if (!['coordinates', 'matrix'].includes(phase) || !/^\d{4}$/.test(term ?? '')) {
  throw new Error('Usage: node supabase/import-uw-walking.mjs coordinates|matrix TERM [Valhalla URL]');
}

const data = join(import.meta.dirname, '.temp', 'uw-walking');
const readJson = async path => JSON.parse((await readFile(path, 'utf8')).replace(/^\uFEFF/, ''));
const saveJson = (filename, value) => writeFile(join(data, filename), JSON.stringify(value, null, 2) + '\n');
const coordinatesFile = 'coordinates-' + term + '.json';
const reviewedLocations = (await readJson(join(import.meta.dirname, 'uw-walking-location-review.json')))[term] ?? {};

async function fetchCoordinates() {
  const buildings = await readJson(join(data, 'buildings-' + term + '.json'));
  const { entries } = await readJson(join(import.meta.dirname, '.temp', 'uw-' + term, 'manifest.json'));
  const courses = new Map(entries.map(entry => [entry.course.id, entry]));
  const positions = new Map(buildings.map(({ building_id }) => [building_id, new Map()]));
  const errors = [];
  const courseIds = [...new Set(buildings.flatMap(row => row.course_ids))];
  await Promise.all(Array.from({ length: 4 }, (_, worker) => (async () => {
    for (let index = worker; index < courseIds.length; index += 4) {
      const courseId = courseIds[index];
      const entry = courses.get(courseId);
      if (!entry) {
        errors.push({ courseId, reason: 'Missing from UW catalog manifest' });
        continue;
      }
      try {
        const packages = await getJson(enroll + '/enrollmentPackages/' + term + '/'
          + entry.subject.subjectCode + '/' + entry.courseId);
        for (const pack of packages) {
          if (pack.published !== true) continue;
          for (const section of pack.sections ?? []) {
            for (const meeting of section.classMeetings ?? []) {
              if (meeting.meetingType !== 'CLASS' || !meeting.building) continue;
              const { buildingCode, latitude, longitude } = meeting.building;
              const values = positions.get('uw-' + buildingCode);
              if (!values || ![latitude, longitude].every(value =>
                (typeof value === 'number' || typeof value === 'string') && String(value).trim())) continue;
              const lat = Number(latitude);
              const lon = Number(longitude);
              if (!(lat > 0 && lat < 90 && lon > -180 && lon < 0)) continue;
              values.set([lat, lon].join(','), { lat, lon });
            }
          }
        }
      } catch (error) {
        errors.push({ courseId, reason: error.message });
      }
      await delay(200);
    }
  })()));
  const coordinates = buildings.map(({ building_id: id, name }) => {
    const reviewed = reviewedLocations[id];
    if (reviewed?.needs_review) return { id, name, ...reviewed };
    const values = [...positions.get(id).values()];
    if (values.length === 1) return { id, name, ...values[0], source: 'UW Course Search & Enroll' };
    if (values.length === 0 && reviewed) return { id, name, ...reviewed };
    return { id, name, needs_review: values.length ? 'Conflicting UW coordinates' : 'No UW coordinates' };
  });
  await saveJson(coordinatesFile, { coordinates, course_lookup_errors: errors });
  console.log(JSON.stringify({
    buildings: coordinates.length, located: coordinates.filter(row => !row.needs_review).length,
    lookupErrors: errors.length,
  }));
}

async function requestMatrix(source, targets) {
  const waypoint = ({ lat, lon }) => ({ lat, lon, search_cutoff: 200 });
  const response = await fetch(new URL('/sources_to_targets', router), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sources: [waypoint(source)], targets: targets.map(waypoint), costing: 'pedestrian',
    }),
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw new Error('Valhalla HTTP ' + response.status + ': ' + await response.text());
  const result = await response.json();
  const row = result.sources_to_targets?.[0];
  if (!Array.isArray(row) || row.length !== targets.length) {
    throw new Error('Valhalla returned an incomplete matrix for ' + source.id);
  }
  for (const [index, cell] of row.entries()) {
    if (cell.from_index !== 0 || cell.to_index !== index) throw new Error('Unexpected Valhalla indices');
  }
  return row;
}

async function buildMatrix() {
  const { coordinates } = await readJson(join(data, coordinatesFile));
  if (!coordinates.length || new Set(coordinates.map(row => row.id)).size !== coordinates.length
      || coordinates.some(row => !/^uw-[a-z0-9-]+$/i.test(row.id))) {
    throw new Error('Invalid UW buildings');
  }
  const located = coordinates.filter(row => !row.needs_review);
  if (located.length < 2) throw new Error('At least two located buildings are required');
  const edges = [];
  const missing = [];
  const pointErrors = new Set();
  for (const [sourceIndex, source] of located.entries()) {
    for (let offset = 0; offset < located.length; offset += 24) {
      const targets = located.slice(offset, offset + 24).filter(target => target.id !== source.id);
      if (!targets.length) continue;
      await addRoutes(source, targets);
    }
    if ((sourceIndex + 1) % 20 === 0) console.log('Routed ' + (sourceIndex + 1) + ' buildings');
  }

  async function addRoutes(source, targets) {
    let row;
    try {
      row = await requestMatrix(source, targets);
    } catch (error) {
      if (!/"error_code"\s*:\s*(171|172|173)\b/.test(error.message)) throw error;
      if (targets.length > 1) {
        const half = Math.ceil(targets.length / 2);
        await addRoutes(source, targets.slice(0, half));
        await addRoutes(source, targets.slice(half));
      } else {
        pointErrors.add(error.message);
        missing.push({ from: source.id, to: targets[0].id, reason: 'Valhalla could not connect waypoints' });
      }
      return;
    }
    for (const [index, cell] of row.entries()) {
      const to = targets[index].id;
      if (!Number.isFinite(cell.time) || cell.time <= 0) {
        missing.push({ from: source.id, to, reason: 'No positive pedestrian route duration' });
        continue;
      }
      edges.push({ from: source.id, to, minutes: Math.ceil(cell.time / 60) });
    }
  }

  if (!edges.length || edges.length + missing.length !== located.length * (located.length - 1)) {
    throw new Error('Incomplete walking matrix');
  }
  const count = coordinates.length;
  const attribution = '© OpenStreetMap contributors, https://www.openstreetmap.org/copyright';
  await saveJson('routes-' + term + '.json', {
    term, routing: 'Valhalla pedestrian', attribution, generated_at: new Date().toISOString(),
    buildings: count, expected_pairs: count * (count - 1), edges: edges.length,
    missing_buildings: coordinates.filter(row => row.needs_review), missing, routing_errors: [...pointErrors],
  });

  // Stage in a temporary table and validate against the live catalog before the upsert.
  const values = edges.map(({ from, to, minutes }) => "('" + from + "', '" + to + "', " + minutes + ')');
  const buildingValues = coordinates.map(({ id }) => "('" + id + "')");
  const edgeRows = values.join(',\n');
  const buildingRows = buildingValues.join(',\n');
  const sql = [
    '-- ' + attribution,
    '-- Valhalla pedestrian estimates, rounded up to whole minutes.',
    'begin;',
    'create temporary table source_buildings (id text primary key) on commit drop;',
    'insert into source_buildings values\n' + buildingRows + ';',
    'create temporary table source_edges (from_id text, to_id text, minutes integer not null check (minutes > 0),',
    '  check (from_id <> to_id), primary key (from_id, to_id)) on commit drop;',
    'insert into source_edges values\n' + edgeRows + ';',
    'do $$ begin',
    '  if exists ((select id from source_buildings except select distinct building_id from public.meetings',
    "    where term = '" + term + "' and building_id like 'uw-%' and mode in ('in_person', 'hybrid'))",
    '    union all (select distinct building_id from public.meetings',
    "    where term = '" + term + "' and building_id like 'uw-%' and mode in ('in_person', 'hybrid')",
    '    except select id from source_buildings)) then',
    "    raise exception 'Walking import building set differs from the current UW term';",
    '  end if;',
    'end $$;',
    'insert into public.walking_edges (from_building_id, to_building_id, minutes, bidirectional)',
    'select from_id, to_id, minutes, false from source_edges',
    'on conflict (from_building_id, to_building_id) do update',
    'set minutes = excluded.minutes, bidirectional = excluded.bidirectional;',
    'commit;',
  ].join('\n');
  await writeFile(join(data, 'walking-' + term + '.sql'), sql + '\n');
  console.log(JSON.stringify({ buildings: count, located: located.length, savedRoutes: edges.length,
    missing: count * (count - 1) - edges.length }));
}

await (phase === 'coordinates' ? fetchCoordinates() : buildMatrix());
