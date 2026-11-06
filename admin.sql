-- ALERT AI — Admin paneli (yalnızca aliefeertem11@gmail.com)
-- Supabase: SQL Editor → New query → bu dosyanın tamamını yapıştır → Run
-- Tekrar çalıştırmak güvenlidir.

-- Yapay zekâ kullanım sayacı (günlük, görev bazında)
create table if not exists public.ai_usage (
  day date not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  task text not null,
  ok integer not null default 0,
  failed integer not null default 0,
  primary key (day, user_id, task)
);
alter table public.ai_usage enable row level security;
-- Doğrudan erişim yok; yalnızca aşağıdaki fonksiyonlar kullanır.

create or replace function public.log_ai(p_task text, p_ok boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return; end if;
  insert into ai_usage(day, user_id, task, ok, failed)
  values ((now() at time zone 'Europe/Istanbul')::date, auth.uid(), left(p_task, 20), case when p_ok then 1 else 0 end, case when p_ok then 0 else 1 end)
  on conflict (day, user_id, task) do update
    set ok = ai_usage.ok + excluded.ok, failed = ai_usage.failed + excluded.failed;
end $$;
revoke all on function public.log_ai(text, boolean) from public, anon;
grant execute on function public.log_ai(text, boolean) to authenticated;

-- Admin kontrolü
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select lower(coalesce(auth.jwt() ->> 'email', '')) = 'aliefeertem11@gmail.com';
$$;
grant execute on function public.is_admin() to authenticated;

-- Genel bakış
create or replace function public.admin_overview() returns json
language plpgsql stable security definer set search_path = public, auth as $$
declare
  t date := (now() at time zone 'Europe/Istanbul')::date;
  r json;
begin
  if not public.is_admin() then raise exception 'Yetkin yok'; end if;
  select json_build_object(
    'users', (select count(*) from auth.users),
    'new_today', (select count(*) from auth.users where (created_at at time zone 'Europe/Istanbul')::date = t),
    'new_7d', (select count(*) from auth.users where created_at > now() - interval '7 days'),
    'active_today', (select count(*) from public.activity where day = t),
    'active_7d', (select count(distinct user_id) from public.activity where day > t - 7),
    'courses', (select count(*) from public.courses),
    'steps_done', (select count(*) from public.step_progress where completed_at is not null),
    'podcasts', (select count(*) from public.podcasts),
    'xp', (select coalesce(sum(xp), 0) from public.profiles),
    'ai_today', (select coalesce(sum(ok), 0) from public.ai_usage where day = t),
    'ai_failed_today', (select coalesce(sum(failed), 0) from public.ai_usage where day = t),
    'ai_tasks_today', (select coalesce(json_object_agg(task, n), '{}'::json) from (select task, sum(ok) n from public.ai_usage where day = t group by task) x),
    'daily', (select json_agg(json_build_object(
        'day', d::date,
        'signups', (select count(*) from auth.users where (created_at at time zone 'Europe/Istanbul')::date = d::date),
        'active', (select count(*) from public.activity a where a.day = d::date),
        'ai', (select coalesce(sum(ok), 0) from public.ai_usage u where u.day = d::date)
      ) order by d)
      from generate_series(t - 13, t, interval '1 day') d),
    'subjects', (select coalesce(json_agg(x), '[]'::json) from (
        select subject, count(*) n from public.courses group by subject order by n desc limit 8) x)
  ) into r;
  return r;
end $$;
revoke all on function public.admin_overview() from public, anon;
grant execute on function public.admin_overview() to authenticated;

-- Kullanıcı listesi
create or replace function public.admin_users() returns json
language plpgsql stable security definer set search_path = public, auth as $$
begin
  if not public.is_admin() then raise exception 'Yetkin yok'; end if;
  return (select coalesce(json_agg(x order by x.created_at desc), '[]'::json) from (
    select u.id, u.email, u.created_at, u.last_sign_in_at,
      p.name, p.grade, coalesce(p.xp, 0) xp, coalesce(p.streak, 0) streak, p.last_active,
      (select count(*) from public.courses c where c.user_id = u.id) courses,
      (select count(*) from public.step_progress s where s.user_id = u.id and s.completed_at is not null) steps,
      (select coalesce(sum(ok), 0) from public.ai_usage a where a.user_id = u.id) ai
    from auth.users u left join public.profiles p on p.id = u.id
  ) x);
end $$;
revoke all on function public.admin_users() from public, anon;
grant execute on function public.admin_users() to authenticated;

-- Tek kullanıcının ayrıntısı
create or replace function public.admin_user_detail(p_user uuid) returns json
language plpgsql stable security definer set search_path = public, auth as $$
begin
  if not public.is_admin() then raise exception 'Yetkin yok'; end if;
  return json_build_object(
    'courses', (select coalesce(json_agg(x order by x.created_at desc), '[]'::json) from (
      select c.id, c.subject, c.exam_name, c.exam_date, c.target_grade, c.scale, c.level, c.created_at,
        (select coalesce(sum(jsonb_array_length(un -> 'steps')), 0) from jsonb_array_elements(c.plan -> 'units') un) total_steps,
        (select count(*) from public.step_progress s where s.course_id = c.id and s.completed_at is not null) done_steps,
        (select round(avg(best_score)) from public.step_progress s where s.course_id = c.id and s.best_score is not null) avg_score
      from public.courses c where c.user_id = p_user) x),
    'mistakes', (select count(*) from public.mistakes where user_id = p_user),
    'podcasts', (select count(*) from public.podcasts where user_id = p_user),
    'activity', (select coalesce(json_agg(json_build_object('day', day, 'xp', xp) order by day), '[]'::json)
                 from public.activity where user_id = p_user and day > (now() at time zone 'Europe/Istanbul')::date - 14)
  );
end $$;
revoke all on function public.admin_user_detail(uuid) from public, anon;
grant execute on function public.admin_user_detail(uuid) to authenticated;

-- Kullanıcıyı ve tüm verisini sil
create or replace function public.admin_delete_user(p_user uuid) returns void
language plpgsql security definer set search_path = public, auth as $$
begin
  if not public.is_admin() then raise exception 'Yetkin yok'; end if;
  if p_user = auth.uid() then raise exception 'Kendi hesabını buradan silemezsin'; end if;
  delete from auth.users where id = p_user;
end $$;
revoke all on function public.admin_delete_user(uuid) from public, anon;
grant execute on function public.admin_delete_user(uuid) to authenticated;
