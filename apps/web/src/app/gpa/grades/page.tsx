import {GpaDashboard} from '@/components/gpa-dashboard';

export default async function EditGradesPage({searchParams}: PageProps<'/gpa/grades'>) {
  const {term} = await searchParams;
  return <GpaDashboard editing initialTerm={typeof term === 'string' ? term : undefined} />;
}
