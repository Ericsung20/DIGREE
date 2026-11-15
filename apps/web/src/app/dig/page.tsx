import {EmptyState, Screen} from '@/components/screen';
import {buildGenerateRequest} from '@/lib/data/generate-request';
import type {DigDefaults} from '@/lib/dig-request';
import {getDigDefaults} from '@/lib/dig-server';
import {usesFixtureRequest} from '@/lib/optimizer';
import {DigClient} from './dig-client';
import {IS_MOCK} from '@/lib/supabase';

function fixtureDefaults(): DigDefaults {
  const req = buildGenerateRequest();
  return {
    term: req.term,
    termLabel: req.term,
    terms: [{id: req.term, label: 'Spring 2027 (sample)'}],
    minCredits: req.constraints.min_credits,
    maxCredits: req.constraints.max_credits,
    earliest: req.constraints.earliest_start_min,
    latest: req.constraints.latest_end_min,
    courses: req.courses.map((c) => ({id: c.course_id, code: c.course_code, credits: c.credit_options.join('/'), required: c.is_required})),
    sample: true,
  };
}

// `?mock=empty|422|503|network` previews the empty and error states when DIGREE_MOCK=1.
export default async function DigPage({searchParams}: PageProps<'/dig'>) {
  const {mock, term} = await searchParams;
  const defaults = usesFixtureRequest() ? fixtureDefaults() : await getDigDefaults(typeof term === 'string' ? term : undefined).catch((error) => {
    console.error('Loading DIG failed', error);
    return 'unavailable' as const;
  });
  return (
    <Screen title="DIG">
      {defaults === 'unavailable' && <EmptyState title="Couldn’t load DIG" body="Refresh the page to try again." />}
      {defaults === 'no-terms' && <EmptyState title="No terms available" body="A term must be in the catalog before you can build a schedule." />}
      {defaults === null && <EmptyState title="Sign in to use DIG" body="Your planned courses are needed to build schedules." />}
      {defaults && typeof defaults === 'object' && <DigClient key={defaults.term} defaults={defaults} canSave={!defaults.sample || IS_MOCK} mock={typeof mock === 'string' ? mock : undefined} />}
    </Screen>
  );
}
