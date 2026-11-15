import {Screen} from '@/components/screen';
import {buildGenerateRequest} from '@/lib/data/generate-request';
import {DigClient, type DigDefaults} from './dig-client';

// `?mock=empty|422|503|network` previews the empty and error states in mock mode.
export default async function DigPage({searchParams}: PageProps<'/dig'>) {
  const {mock} = await searchParams;
  const req = buildGenerateRequest();
  const defaults: DigDefaults = {
    term: req.term,
    minCredits: req.constraints.min_credits,
    maxCredits: req.constraints.max_credits,
    earliest: req.constraints.earliest_start_min,
    latest: req.constraints.latest_end_min,
    courses: req.courses.map((c) => ({id: c.course_id, code: c.course_code, credits: c.credit_options[0], required: c.is_required})),
  };
  return (
    <Screen title="DIG">
      <DigClient defaults={defaults} mock={typeof mock === 'string' ? mock : undefined} />
    </Screen>
  );
}
