// Reads a DARS report in the browser. The file never leaves the device: only the course codes
// found in it are compared with the course history, and nothing is saved until the student says so.

export type DarsCourse = {code: string; season: 'Fall' | 'Spring' | 'Summer'; year: number};
export type DarsReading = {readable: false} | {readable: true; courses: DarsCourse[]};

const SEASON = {FA: 'Fall', SP: 'Spring', SU: 'Summer'} as const;
// A finished course is printed as "FA24 COMP SCI 300  3.00 A  ...": term, subject, number.
const TAKEN = /\b(FA|SP|SU)(\d{2})\s+([A-Z][A-Z&/ ]{1,24}?)\s+(\d{3})\b([^\n]*)/g;
const IN_PROGRESS = /\b(IP|INP|>I)\b/;

async function inflate(bytes: Uint8Array): Promise<Uint8Array | null> {
  if (typeof DecompressionStream === 'undefined') return null;
  try {
    const stream = new Blob([bytes.slice()]).stream().pipeThrough(new DecompressionStream('deflate'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  } catch {
    return null; // not a deflate stream (an image, a font): skip it
  }
}

/** The words a page draws, in drawing order. Enough for the typewriter-style text DARS produces. */
function shownText(content: string): string {
  let text = '';
  for (const match of content.matchAll(/\((?:\\.|[^\\()])*\)|\b(?:Td|TD|Tm|ET)\b|T\*|'/g)) {
    const token = match[0];
    text += token.startsWith('(') ? token.slice(1, -1).replace(/\\([()\\])/g, '$1') : '\n';
  }
  return text;
}

export async function readDars(file: File): Promise<DarsReading> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const latin1 = new TextDecoder('latin1');
  const raw = latin1.decode(bytes);
  if (!raw.startsWith('%PDF-')) return {readable: false};

  let text = '';
  for (const match of raw.matchAll(/stream\r?\n/g)) {
    const start = match.index + match[0].length;
    const end = raw.indexOf('endstream', start);
    if (end < 0) break;
    const unpacked = await inflate(bytes.subarray(start, end));
    text += shownText(unpacked ? latin1.decode(unpacked) : raw.slice(start, end));
  }
  if ((text.match(/[A-Za-z]{3,}/g) ?? []).length < 20) return {readable: false};

  const courses = new Map<string, DarsCourse>();
  for (const [, season, year, subject, number, rest] of text.matchAll(TAKEN)) {
    if (IN_PROGRESS.test(rest)) continue; // still being taken: not part of the finished history
    const code = `${subject.trim().replace(/\s+/g, ' ')} ${number}`;
    courses.set(code, {code, season: SEASON[season as keyof typeof SEASON], year: 2000 + Number(year)});
  }
  return {readable: true, courses: [...courses.values()]};
}
