-- Private report storage. Only the Edge Function's server-side role can use it.
create table public.lyrics_reports (
  report_id uuid primary key,
  created_at timestamptz not null default now(),
  consent_version integer not null default 1 check (consent_version = 1),
  report jsonb not null check (jsonb_typeof(report) = 'object' and octet_length(report::text) < 4096)
);
create index lyrics_reports_created_at on public.lyrics_reports (created_at);
create table public.lyrics_report_limits (
  bucket text primary key,
  hits integer not null check (hits >= 0),
  expires_at timestamptz not null
);
alter table public.lyrics_reports enable row level security;
alter table public.lyrics_report_limits enable row level security;
revoke all on public.lyrics_reports, public.lyrics_report_limits from public, anon, authenticated;
grant select, insert, delete on public.lyrics_reports to service_role;
grant select, insert, update, delete on public.lyrics_report_limits to service_role;

-- SECURITY INVOKER: only service_role can call this function or access tables.
-- One transaction serializes the intake budget, deduplicates retries, and writes.
create function public.accept_lyrics_report(p_id uuid, p_report jsonb, p_client_hash text)
returns text language plpgsql security invoker set search_path = '' as $$
declare
  day_bucket text := 'day:' || to_char(now() at time zone 'utc', 'YYYY-MM-DD');
  client_bucket text := 'client:' || to_char(now() at time zone 'utc', 'YYYY-MM-DD-HH24') || ':' || p_client_hash;
begin
  if p_client_hash !~ '^[a-f0-9]{64}$' or jsonb_typeof(p_report) <> 'object' or octet_length(p_report::text) >= 4096 then
    raise exception 'invalid_report';
  end if;
  perform pg_advisory_xact_lock(712306217);
  delete from public.lyrics_report_limits where expires_at < now();
  delete from public.lyrics_reports where created_at < now() - interval '90 days';
  if exists (select 1 from public.lyrics_reports where report_id = p_id) then return p_id::text; end if;
  if exists (select 1 from public.lyrics_report_limits where (bucket = day_bucket and hits >= 200) or (bucket = client_bucket and hits >= 5)) then return 'rate_limited'; end if;
  insert into public.lyrics_report_limits (bucket, hits, expires_at)
    values (day_bucket, 1, now() + interval '2 days'), (client_bucket, 1, now() + interval '2 days')
    on conflict (bucket) do update set hits = public.lyrics_report_limits.hits + 1;
  insert into public.lyrics_reports (report_id, report) values (p_id, p_report);
  return p_id::text;
end;
$$;
revoke all on function public.accept_lyrics_report(uuid, jsonb, text) from public, anon, authenticated;
grant execute on function public.accept_lyrics_report(uuid, jsonb, text) to service_role;
