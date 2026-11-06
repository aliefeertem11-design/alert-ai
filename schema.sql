-- ALERT AI — Supabase veritabanı şeması
-- Supabase panelinde: SQL Editor → New query → bu dosyanın tamamını yapıştır → Run

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text,
  grade text,
  xp integer not null default 0,
  streak integer not null default 0,
  last_active date,
  daily_goal integer not null default 30,
  voice_a text not null default 'Kore',
  voice_b text not null default 'Puck',
  created_at timestamptz not null default now()
);

create table if not exists public.courses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  subject text not null,
  exam_name text not null,
  exam_date date,
  target_grade text,
  scale text,
  level integer,
  material text,
  plan jsonb not null,
  created_at timestamptz not null default now()
);
create index if not exists courses_user_idx on public.courses(user_id);

create table if not exists public.step_progress (
  user_id uuid not null references auth.users(id) on delete cascade,
  course_id uuid not null references public.courses(id) on delete cascade,
  step_id text not null,
  content jsonb,
  stars integer not null default 0,
  best_score integer,
  completed_at timestamptz,
  primary key (user_id, course_id, step_id)
);

create table if not exists public.mistakes (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  course_id uuid references public.courses(id) on delete cascade,
  question text not null,
  user_answer text,
  correct_answer text,
  explanation text,
  resolved boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.activity (
  user_id uuid not null references auth.users(id) on delete cascade,
  day date not null,
  xp integer not null default 0,
  primary key (user_id, day)
);

create table if not exists public.podcasts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  course_id uuid references public.courses(id) on delete set null,
  title text not null,
  style text,
  segments jsonb not null,
  created_at timestamptz not null default now()
);

-- Güvenlik: herkes yalnızca kendi verisini görebilir ve değiştirebilir
alter table public.profiles enable row level security;
alter table public.courses enable row level security;
alter table public.step_progress enable row level security;
alter table public.mistakes enable row level security;
alter table public.activity enable row level security;
alter table public.podcasts enable row level security;

drop policy if exists "own profile" on public.profiles;
create policy "own profile" on public.profiles for all using (auth.uid() = id) with check (auth.uid() = id);
drop policy if exists "own courses" on public.courses;
create policy "own courses" on public.courses for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "own progress" on public.step_progress;
create policy "own progress" on public.step_progress for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "own mistakes" on public.mistakes;
create policy "own mistakes" on public.mistakes for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "own activity" on public.activity;
create policy "own activity" on public.activity for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "own podcasts" on public.podcasts;
create policy "own podcasts" on public.podcasts for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Hesap silme: kullanıcı kendi hesabını ve tüm verisini siler
create or replace function public.delete_my_account() returns void
language sql security definer set search_path = public as $$
  delete from auth.users where id = auth.uid();
$$;
revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;
