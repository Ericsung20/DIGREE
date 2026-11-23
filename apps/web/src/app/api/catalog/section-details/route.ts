import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {normalizeSectionDetails, type RawPackage} from '@/lib/section-details';
import {supabaseServer} from '@/lib/supabase-server';

const run = promisify(execFile);
const cache = new Map<string, {expires: number; data: Promise<RawPackage[]>}>();
async function packages(url: string): Promise<RawPackage[]> {
  const previous = cache.get(url);
  if (previous && previous.expires > Date.now()) return previous.data;
  const data = (async () => {
    if (process.platform === 'win32') {
      const {stdout} = await run('powershell.exe', ['-NoProfile', '-Command', '$ErrorActionPreference="Stop"; [Console]::OutputEncoding=[Text.UTF8Encoding]::new(); (Invoke-WebRequest -Uri $env:DIGREE_SECTION_URL -UseBasicParsing -TimeoutSec 12).Content'], {env: {...process.env, DIGREE_SECTION_URL: url}, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, timeout: 15000, windowsHide: true});
      return JSON.parse(stdout) as RawPackage[];
    }
    const response = await fetch(url, {signal: AbortSignal.timeout(12000)});
    if (!response.ok) throw new Error('Section source unavailable');
    return await response.json() as RawPackage[];
  })();
  if (cache.size >= 128) cache.delete(cache.keys().next().value!);
  cache.set(url, {expires: Date.now() + 15 * 60000, data});
  data.catch(() => cache.delete(url));
  return data;
}
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const term = params.get('term') ?? '', course = params.get('course') ?? '', bundle = params.get('bundle') ?? '';
  if (!/^\d{4}$/.test(term) || !/^uw-\d+$/.test(course) || bundle.length > 200) return Response.json({error: 'Invalid section.'}, {status: 400});
  const db = await supabaseServer();
  const {data: auth} = await db.auth.getUser();
  if (!auth.user) return Response.json({error: 'Sign in to view section details.'}, {status: 401});
  const {data, error} = await db.from('section_bundles').select('bundle_id').eq('term', term).eq('course_id', course).eq('bundle_id', bundle).maybeSingle();
  if (error) return Response.json({error: 'Couldn’t read this section.'}, {status: 503});
  const subject = new RegExp(`^${term}-[A-Z]\\d+-(\\d+)-`).exec(data?.bundle_id ?? '')?.[1];
  if (!subject) return Response.json({error: 'Detailed section information is unavailable.'}, {status: 404});
  // Fixed host/path and validated numeric IDs; no arbitrary source URL is fetched.
  const url = `https://public.enroll.wisc.edu/api/search/v1/enrollmentPackages/${term}/${subject}/${course.slice(3)}`;
  try {
    const source = await packages(url);
    const pack = source.find(item => item.docId === bundle);
    if (!pack) return Response.json({error: 'This section is absent from the published catalog.'}, {status: 404});
    return Response.json({details: normalizeSectionDetails(pack)});
  } catch {return Response.json({error: 'Detailed section information is temporarily unavailable.'}, {status: 503});}
}
