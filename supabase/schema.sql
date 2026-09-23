-- Graphboard classroom schema
-- Run this in the Supabase SQL editor.

-- Profiles (one row per auth user, created automatically on signup)
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  full_name text default '',
  role text not null default 'student' check (role in ('admin', 'teacher', 'student')),
  created_at timestamptz not null default now()
);

-- Classes (owned by a teacher)
create table if not exists public.classes (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references public.profiles (id) on delete cascade,
  name text not null,
  join_code text not null unique,
  created_at timestamptz not null default now()
);

-- Class membership (students enrolled in a class)
create table if not exists public.class_members (
  class_id uuid not null references public.classes (id) on delete cascade,
  student_id uuid not null references public.profiles (id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (class_id, student_id)
);

-- Exercises (text prompt + optional auto-check steps)
create table if not exists public.exercises (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public.classes (id) on delete cascade,
  title text not null,
  prompt text not null default '',
  steps jsonb not null default '[]',
  created_at timestamptz not null default now()
);

-- Submissions (student's saved canvas per exercise)
create table if not exists public.submissions (
  id uuid primary key default gen_random_uuid(),
  exercise_id uuid not null references public.exercises (id) on delete cascade,
  student_id uuid not null references public.profiles (id) on delete cascade,
  actions jsonb not null default '[]',
  status text not null default 'draft' check (status in ('draft', 'submitted')),
  score integer,
  feedback text,
  submitted_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (exercise_id, student_id)
);

-- The student's recorded session video. Stored in the "submission-videos"
-- Storage bucket as '<student_id>/<submission_id>.webm'; this column holds the
-- storage object path. Older rows hold legacy base64 data URLs (handled by the
-- client). Storage RLS governs upload/download (see the storage section below).
alter table public.submissions add column if not exists video text;

-- Settings (key/value store, e.g. the teacher access code)
create table if not exists public.settings (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);

-- Teacher access code: auto-generated, rotatable. Any authenticated teacher can
-- read it or rotate it to a new random code.
create or replace function public.rotate_teacher_code()
returns text
language sql
security definer set search_path = public
as $$
  insert into public.settings (key, value)
  values ('teacher_access_code', upper(substr(md5(random()::text), 1, 8)))
  on conflict (key) do update
    set value = excluded.value, updated_at = now()
  returning value;
$$;

create or replace function public.get_teacher_access_code()
returns text
language sql
security definer set search_path = public
stable
as $$
  select value from public.settings where key = 'teacher_access_code';
$$;

-- Seed an initial teacher access code if the settings table is empty
insert into public.settings (key, value)
select 'teacher_access_code', upper(substr(md5(random()::text), 1, 8))
where not exists (select 1 from public.settings where key = 'teacher_access_code');

-- Admin role helpers -------------------------------------------------------
-- is_admin() is used by the RLS policies below, so it is security definer and
-- reads the profile directly to avoid policy recursion.
create or replace function public.is_admin()
returns boolean
language sql
security definer set search_path = public
stable
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'admin'
  );
$$;

-- Change a user's role. Security definer (bypasses RLS) but guards the caller:
--  - an existing admin may change anyone's role;
--  - if no admin exists yet, any signed-in user may promote *themselves* to
--    admin, which bootstraps the first admin (the teacher access code gates
--    teacher signup; the admin bootstrap should be disabled once the site has
--    an admin).
create or replace function public.admin_set_role(p_user_id uuid, p_role text)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  v_caller_role text;
  v_admin_count bigint;
begin
  if p_role not in ('admin', 'teacher', 'student') then
    raise exception 'Invalid role: %', p_role;
  end if;
  select role into v_caller_role from public.profiles where id = auth.uid();
  if v_caller_role <> 'admin' then
    select count(*) into v_admin_count from public.profiles where role = 'admin';
    if not (v_admin_count = 0 and p_user_id = auth.uid() and p_role = 'admin') then
      raise exception 'Only an admin can change roles';
    end if;
  end if;
  update public.profiles set role = p_role where id = p_user_id;
end;
$$;

grant execute on function public.admin_set_role(uuid, text) to authenticated;
grant execute on function public.is_admin() to anon, authenticated;


-- Row Level Security ---------------------------------------------------

alter table public.profiles enable row level security;
alter table public.classes enable row level security;
alter table public.class_members enable row level security;
alter table public.exercises enable row level security;
alter table public.submissions enable row level security;
alter table public.settings enable row level security;

-- Profiles: a user can read and update their own profile
create policy "own profile" on public.profiles
  for all using (auth.uid() = id) with check (auth.uid() = id);

-- Security-definer helper so teachers can read the names of students in their
-- classes without RLS recursion (class_members/classes policies reference
-- profiles, so a plain policy on profiles would cycle).
create or replace function public.teacher_can_read_student(p_student_id uuid)
returns boolean
language sql
security definer set search_path = public
stable
as $$
  select exists (
    select 1 from public.class_members m
    join public.classes c on c.id = m.class_id
    where m.student_id = p_student_id
      and c.teacher_id = auth.uid()
  );
$$;
grant execute on function public.teacher_can_read_student(uuid) to authenticated;

-- Teachers can see the names of the students enrolled in their classes, so the
-- class roster and submission lists can show who submitted what.
create policy "teachers read student profiles" on public.profiles
  for select using (public.teacher_can_read_student(id));

-- Classes: teacher owns, students can join by code
create policy "teachers manage own classes" on public.classes
  for all using (auth.uid() = teacher_id) with check (auth.uid() = teacher_id);

create policy "students read classes by join code" on public.classes
  for select using (
    join_code is not null
    and exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'student')
  );

-- Class members: students can join, members can read
create policy "students join classes" on public.class_members
  for insert with check (auth.uid() = student_id);

-- Join a class by join code. Security definer so anon/pre-signup users can
-- validate the code; it verifies the caller is a student and then enrolls them.
create or replace function public.join_class(p_code text)
returns uuid
language plpgsql
security definer set search_path = public
as $$
declare
  v_class_id uuid;
  v_role text;
begin
  select role into v_role from public.profiles where id = auth.uid();
  if v_role is distinct from 'student' then
    raise exception 'Only students can join a class';
  end if;
  select id into v_class_id from public.classes where upper(join_code) = upper(p_code);
  if v_class_id is null then
    raise exception 'That join code is not valid';
  end if;
  insert into public.class_members (class_id, student_id)
  values (v_class_id, auth.uid())
  on conflict (class_id, student_id) do nothing;
  return v_class_id;
end;
$$;
grant execute on function public.join_class(text) to anon, authenticated;

create policy "members read own classes" on public.class_members
  for select using (auth.uid() = student_id);

create policy "teachers read member lists" on public.class_members
  for select using (
    exists (select 1 from public.classes c where c.id = class_id and c.teacher_id = auth.uid())
  );

-- Exercises: teachers manage their classes' exercises, students read theirs
create policy "teachers manage exercises" on public.exercises
  for all using (
    exists (select 1 from public.classes c where c.id = class_id and c.teacher_id = auth.uid())
  ) with check (
    exists (select 1 from public.classes c where c.id = class_id and c.teacher_id = auth.uid())
  );

create policy "students read class exercises" on public.exercises
  for select using (
    exists (select 1 from public.class_members m where m.class_id = class_id and m.student_id = auth.uid())
  );

-- Submissions: student owns theirs, teacher reads their class's
create policy "students manage own submissions" on public.submissions
  for all using (auth.uid() = student_id) with check (auth.uid() = student_id);

create policy "teachers read submissions" on public.submissions
  for select using (
    exists (
      select 1 from public.exercises e
      join public.classes c on c.id = e.class_id
      where e.id = exercise_id and c.teacher_id = auth.uid()
    )
  );

-- Settings: teachers can read the access code; nobody writes directly
-- (rotation goes through rotate_teacher_code).
create policy "teachers read settings" on public.settings
  for select using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'teacher'));

-- The access code is read pre-auth (during the signup form), so it is exposed to
-- anon; this mirrors having it baked into the client. Rotation is authenticated-only.
grant execute on function public.rotate_teacher_code() to authenticated;
grant execute on function public.get_teacher_access_code() to anon, authenticated;

-- Admins can read and manage everything.
create policy "admin full access profiles" on public.profiles
  for all using (public.is_admin()) with check (public.is_admin());

create policy "admin full access classes" on public.classes
  for all using (public.is_admin()) with check (public.is_admin());

create policy "admin full access class_members" on public.class_members
  for all using (public.is_admin()) with check (public.is_admin());

create policy "admin full access exercises" on public.exercises
  for all using (public.is_admin()) with check (public.is_admin());

create policy "admin full access submissions" on public.submissions
  for all using (public.is_admin()) with check (public.is_admin());

create policy "admin full access settings" on public.settings
  for all using (public.is_admin()) with check (public.is_admin());

-- Storage -------------------------------------------------------------------
-- Submission videos live in a private bucket; RLS on storage.objects governs
-- who may upload/download them.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('submission-videos', 'submission-videos', false, 52428800, array['video/webm', 'video/mp4'])
on conflict (id) do nothing;

create policy "owners upload own videos" on storage.objects
  for insert to authenticated with check (
    bucket_id = 'submission-videos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "owners update own videos" on storage.objects
  for update to authenticated using (
    bucket_id = 'submission-videos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "owners delete own videos" on storage.objects
  for delete to authenticated using (
    bucket_id = 'submission-videos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "read class videos" on storage.objects
  for select to authenticated using (
    bucket_id = 'submission-videos'
    and (
      (storage.foldername(name))[1] = auth.uid()::text
      or exists (
        select 1 from public.submissions s
        join public.exercises e on e.id = s.exercise_id
        join public.classes c on c.id = e.class_id
        where s.video = name and c.teacher_id = auth.uid()
      )
      or public.is_admin()
    )
  );

-- Auto-create a profile on signup
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name, role)
  values (new.id, new.email, '', 'student')
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
