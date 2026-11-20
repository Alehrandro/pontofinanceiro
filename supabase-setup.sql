-- ════════════════════════════════════════════════════════════════════════════
--  Ponto & Finanças — migração: login por usuário + segurança (RLS)
--
--  COMO USAR: Supabase → SQL Editor → New query → cole TUDO → Run.
--  Pode rodar mais de uma vez sem problema. Seus dados atuais são mantidos
--  e passam a pertencer ao administrador.
--
--  Administrador = a conta alehs@gmail.com, se existir; senão a conta
--  alehrandrosantos677@gmail.com (a que você usa hoje).
-- ════════════════════════════════════════════════════════════════════════════

-- 0) Descobre o admin
create or replace function public.pf_admin_id() returns uuid
language sql stable as $$
  select id from auth.users
   where lower(email) in ('alehs@gmail.com', 'alehrandrosantos677@gmail.com')
   order by (lower(email) = 'alehs@gmail.com') desc
   limit 1;
$$;

do $$
begin
  if public.pf_admin_id() is null then
    raise exception 'Nenhuma conta admin encontrada. Crie o usuário em Authentication > Users (Auto Confirm) e rode de novo.';
  end if;
end $$;

-- 1) Administradores
create table if not exists public.app_admins (
  user_id uuid primary key references auth.users(id) on delete cascade
);
insert into public.app_admins (user_id) values (public.pf_admin_id()) on conflict do nothing;
delete from public.app_admins where user_id <> public.pf_admin_id();

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.app_admins where user_id = auth.uid());
$$;

-- 2) Configurações por usuário (hora extra e PIN)
create table if not exists public.user_config (
  user_id uuid primary key references auth.users(id) on delete cascade,
  overtime_rate numeric default 15.55,
  global_pin text,
  updated_at timestamptz default now()
);

-- 3) day_data e finance_data ganham user_id (chave estrangeira para auth.users)
do $$
declare
  adm uuid := public.pf_admin_id();
  r record;
begin
  -- day_data
  alter table public.day_data add column if not exists user_id uuid;
  update public.day_data set user_id = adm where user_id is null;
  alter table public.day_data alter column user_id set not null;
  for r in select conname from pg_constraint
           where conrelid = 'public.day_data'::regclass and contype in ('p', 'u') loop
    execute format('alter table public.day_data drop constraint %I', r.conname);
  end loop;
  alter table public.day_data add primary key (user_id, day_key);
  if not exists (select 1 from pg_constraint where conname = 'day_data_user_id_fkey' and conrelid = 'public.day_data'::regclass) then
    alter table public.day_data add constraint day_data_user_id_fkey
      foreign key (user_id) references auth.users(id) on delete cascade;
  end if;

  -- finance_data
  alter table public.finance_data add column if not exists user_id uuid;
  update public.finance_data set user_id = adm where user_id is null;
  alter table public.finance_data alter column user_id set not null;
  for r in select conname from pg_constraint
           where conrelid = 'public.finance_data'::regclass and contype in ('p', 'u') loop
    execute format('alter table public.finance_data drop constraint %I', r.conname);
  end loop;
  alter table public.finance_data add primary key (user_id, month_key);
  if not exists (select 1 from pg_constraint where conname = 'finance_data_user_id_fkey' and conrelid = 'public.finance_data'::regclass) then
    alter table public.finance_data add constraint finance_data_user_id_fkey
      foreign key (user_id) references auth.users(id) on delete cascade;
  end if;

  -- hora extra e PIN atuais passam a ser do admin
  insert into public.user_config (user_id, overtime_rate, global_pin)
    select adm, coalesce(overtime_rate, 15.55), global_pin from public.app_config where id = 'global'
    on conflict (user_id) do nothing;
  update public.app_config set global_pin = null where id = 'global';
end $$;

-- 4) Remove políticas antigas (as que deixavam tudo aberto)
do $$
declare p record;
begin
  for p in select policyname, tablename from pg_policies
           where schemaname = 'public'
             and tablename in ('day_data', 'finance_data', 'app_config', 'user_config', 'app_admins') loop
    execute format('drop policy %I on public.%I', p.policyname, p.tablename);
  end loop;
  for p in select policyname from pg_policies
           where schemaname = 'storage' and tablename = 'objects'
             and (coalesce(qual, '') ilike '%covers%' or coalesce(with_check, '') ilike '%covers%') loop
    execute format('drop policy %I on storage.objects', p.policyname);
  end loop;
end $$;

-- 5) Segurança por linha (RLS)
alter table public.day_data     enable row level security;
alter table public.finance_data enable row level security;
alter table public.user_config  enable row level security;
-- textos e contas do Guia de investimentos (editados pelo admin na aba Config)
alter table public.app_config add column if not exists guide_config jsonb;

alter table public.app_config   enable row level security;
alter table public.app_admins   enable row level security;

revoke all on public.day_data, public.finance_data, public.user_config, public.app_admins from anon;
grant select, insert, update, delete on public.day_data, public.finance_data, public.user_config to authenticated;
grant select on public.app_admins to authenticated;
grant select on public.app_config to anon, authenticated;
grant insert, update, delete on public.app_config to authenticated;

create policy "dono: day_data" on public.day_data
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "dono: finance_data" on public.finance_data
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "dono: user_config" on public.user_config
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "ler propria linha de admin" on public.app_admins
  for select to authenticated using (user_id = auth.uid());

-- capa: todos leem (aparece no login); só o admin altera
create policy "capa: leitura publica" on public.app_config
  for select to anon, authenticated using (true);
create policy "capa: admin insere" on public.app_config
  for insert to authenticated with check (public.is_admin());
create policy "capa: admin atualiza" on public.app_config
  for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "capa: admin apaga" on public.app_config
  for delete to authenticated using (public.is_admin());

-- 6) Imagem da capa (Storage): leitura pública, escrita só do admin
insert into storage.buckets (id, name, public) values ('covers', 'covers', true)
  on conflict (id) do update set public = true;

create policy "covers: leitura" on storage.objects
  for select to anon, authenticated using (bucket_id = 'covers');
create policy "covers: admin envia" on storage.objects
  for insert to authenticated with check (bucket_id = 'covers' and public.is_admin());
create policy "covers: admin atualiza" on storage.objects
  for update to authenticated using (bucket_id = 'covers' and public.is_admin())
  with check (bucket_id = 'covers' and public.is_admin());
create policy "covers: admin apaga" on storage.objects
  for delete to authenticated using (bucket_id = 'covers' and public.is_admin());

-- 7) Limpeza e recarga do cache da API
drop function if exists public.pf_admin_id();
notify pgrst, 'reload schema';
