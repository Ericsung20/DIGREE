import {GpaDashboard} from '@/components/gpa-dashboard';

export default async function GpaPage({searchParams}: PageProps<'/gpa'>) {
  const {term} = await searchParams;
  return <GpaDashboard initialTerm={typeof term === 'string' ? term : undefined} />;
}
