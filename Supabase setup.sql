-- ════════════════════════════════════════════════════════════════════════════
--  Ponto & Finanças — configuração de login e segurança no Supabase
--
--  ANTES DE RODAR:
--   1) Supabase → Authentication → Users → "Add user" → "Create new user"
--        e-mail:  alehrandrosantos677@gmail.com
--        senha:   a senha do admin
--        marque "Auto Confirm User"
--   2) Supabase → SQL Editor → cole este arquivo inteiro → Run.
--
--  O que faz: cada usuário passa a ter seus próprios dados (ponto e finanças),
--  seus dados atuais ficam com o admin, e só o admin troca a imagem de capa.
--  Pode rodar de novo sem problema.
-- ════════════════════════════════════════════════════════════════════════════

-- 0) O usuário admin precisa existir
do $$
begin
  if not exists (select 1 from auth.users where lower(email) = 'alehrandrosantos677@gmail.com') then
    raise exception 'Crie primeiro o usuário admin em Authentication > Users (alehrandrosantos677@gmail.com) e rode este script de novo.';
  end if;
end $$;

-- 1) Tabela de administradores + função de checagem
create table if not exists public.app_admins (
  user_id uuid primary key references auth.users(id) on delete cascade
);
insert into public.app_admins (user_id)
  select id from auth.users where lower(email) = 'alehrandrosantos677@gmail.com'
  on conflict do nothing;

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

-- 3) Dados por usuário: day_data e finance_data ganham user_id
do $$
declare
  adm uuid;
  r record;
begin
  select id into adm from auth.users where lower(email) = 'alehrandrosantos677@gmail.com';

  -- day_data
  alter table public.day_data add column if not exists user_id uuid references auth.users(id) on delete cascade;
  update public.day_data set user_id = adm where user_id is null;
  alter table public.day_data alter column user_id set not null;
  for r in select conname from pg_constraint where conrelid = 'public.day_data'::regclass and contype = 'p' loop
    execute format('alter table public.day_data drop constraint %I', r.conname);
  end loop;
  alter table public.day_data add primary key (user_id, day_key);

  -- finance_data
  alter table public.finance_data add column if not exists user_id uuid references auth.users(id) on delete cascade;
  update public.finance_data set user_id = adm where user_id is null;
  alter table public.finance_data alter column user_id set not null;
  for r in select conname from pg_constraint where conrelid = 'public.finance_data'::regclass and contype = 'p' loop
    execute format('alter table public.finance_data drop constraint %I', r.conname);
  end loop;
  alter table public.finance_data add primary key (user_id, month_key);

  -- hora extra e PIN atuais passam a ser do admin
  insert into public.user_config (user_id, overtime_rate, global_pin)
    select adm, coalesce(overtime_rate, 15.55), global_pin from public.app_config where id = 'global'
    on conflict (user_id) do nothing;
  -- o PIN não pode ficar na tabela pública da capa
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
alter table public.app_config   enable row level security;
alter table public.app_admins   enable row level security;

revoke all on public.day_data, public.finance_data, public.user_config, public.app_admins from anon;
grant select, insert, update, delete on public.day_data, public.finance_data, public.user_config to authenticated;
grant select on public.app_admins to authenticated;
grant select on public.app_config to anon, authenticated;
grant insert, update, delete on public.app_config to authenticated;

-- cada usuário só vê e altera as próprias linhas
create policy "dono: day_data" on public.day_data
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "dono: finance_data" on public.finance_data
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "dono: user_config" on public.user_config
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- o usuário só lê a própria linha de admin
create policy "ler propria linha de admin" on public.app_admins
  for select to authenticated using (user_id = auth.uid());

-- capa: todos leem (aparece na tela de login); só o admin altera
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

-- Faz o PostgREST enxergar as mudanças de imediato
notify pgrst, 'reload schema';
