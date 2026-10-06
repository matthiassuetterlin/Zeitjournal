-- Online-Abgleich für das Zeitjournal (Supabase, kostenloser Plan)
-- Einmal im Supabase-Dashboard unter „SQL Editor“ einfügen und „Run“ drücken.
--
-- Gespeichert wird nur ein verschlüsselter Block je Sync-Schlüssel. Der Schlüssel selbst
-- verlässt nie das Gerät; der Server sieht nur eine daraus abgeleitete Kennung und
-- verschlüsselte Daten. Direkter Tabellenzugriff ist gesperrt, es gehen nur die zwei Funktionen.

create table if not exists public.zeitjournal_sync (
  id text primary key,
  rev bigint not null,
  data text not null,
  updated_at timestamptz not null default now()
);
alter table public.zeitjournal_sync enable row level security;
-- absichtlich keine Policies: ohne die Funktionen unten kommt niemand an die Tabelle
revoke all on public.zeitjournal_sync from anon, authenticated;

-- Stand holen: liefert Revision und verschlüsselte Daten (oder nichts)
create or replace function public.zj_pull(p_id text)
returns table (rev bigint, data text)
language sql security definer set search_path = public as $$
  select s.rev, s.data from public.zeitjournal_sync s where s.id = p_id;
$$;

-- Stand hochladen: klappt nur, wenn p_rev der aktuellen Revision entspricht (0 = neu).
-- Rückgabe: neue Revision, oder -1 wenn inzwischen ein anderes Gerät hochgeladen hat.
create or replace function public.zj_push(p_id text, p_data text, p_rev bigint)
returns bigint
language plpgsql security definer set search_path = public as $$
declare cur bigint;
begin
  if p_id !~ '^[0-9a-f]{64}$' or length(p_data) > 5000000 then
    raise exception 'ungültige Daten';
  end if;
  select s.rev into cur from public.zeitjournal_sync s where s.id = p_id for update;
  if cur is null then
    if p_rev <> 0 then return -1; end if;
    insert into public.zeitjournal_sync (id, rev, data) values (p_id, 1, p_data)
      on conflict (id) do nothing;
    if not found then return -1; end if;
    return 1;
  end if;
  if cur <> p_rev then return -1; end if;
  update public.zeitjournal_sync set rev = cur + 1, data = p_data, updated_at = now() where id = p_id;
  return cur + 1;
end;
$$;

revoke all on function public.zj_pull(text) from public;
revoke all on function public.zj_push(text, text, bigint) from public;
grant execute on function public.zj_pull(text) to anon;
grant execute on function public.zj_push(text, text, bigint) to anon;
