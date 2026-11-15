alter table public.section_bundles
    add column section_label text,
    add column instructors text[] not null default '{}';
