import Link from 'next/link';
import {FLAIRS, isFlair, type Post} from '@/lib/data/community';

export function PostLabels({post, courseCode, feedHref = '/community'}: {post: Post; courseCode?: string; feedHref?: string}) {
  const query = new URLSearchParams(feedHref.split('?')[1] ?? '');
  query.set('flair', post.category);
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs font-extrabold">
      {isFlair(post.category) && (
        <Link href={`/community?${query}`} className="rounded-full bg-accent-soft px-2.5 py-1 text-accent">
          {FLAIRS[post.category]}
        </Link>
      )}
      {post.course_id && (
        <Link href={`/community?course=${encodeURIComponent(post.course_id)}`} className="rounded-full bg-sky-100 px-2.5 py-1 text-sky-900">
          {courseCode ?? post.course_id}
        </Link>
      )}
    </div>
  );
}
