-- Carteira Terminal: banco do login e das assinaturas.
-- Como usar: Supabase → SQL Editor → New query → cole este arquivo inteiro → Run.
-- Pode rodar de novo sem estragar nada (usa "if not exists" / "or replace").
-- Não há segredo aqui. A chave service_role nunca entra neste arquivo nem no código do site.

-- ---------------------------------------------------------------------------
-- 1. Assinaturas: quem tem qual plano.
--    O navegador só LÊ a própria linha. Quem ESCREVE é a Edge Function do webhook de pagamento,
--    usando a service_role (que ignora o RLS). Por isso não existe política de insert/update/delete.
-- ---------------------------------------------------------------------------
create table if not exists public.assinaturas (
  user_id        uuid primary key references auth.users (id) on delete cascade,
  plano          text not null check (plano in ('inicial', 'pro')),
  status         text not null default 'ativa' check (status in ('ativa', 'atrasada', 'cancelada', 'teste')),
  valido_ate     timestamptz,                    -- fim do período já pago
  provedor       text,                           -- ex.: 'asaas'
  id_externo     text,                           -- id da assinatura no provedor de pagamento
  atualizado_em  timestamptz not null default now()
);

alter table public.assinaturas enable row level security;

drop policy if exists "le_propria_assinatura" on public.assinaturas;
create policy "le_propria_assinatura" on public.assinaturas
  for select to authenticated
  using (auth.uid() = user_id);
-- (de propósito: nenhuma política de insert, update ou delete para clientes)

-- ---------------------------------------------------------------------------
-- 2. Dados do usuário: onde carteira, diário e favoritos serão sincronizados (etapa futura).
--    Um valor JSON por usuário e chave (ex.: 'carteira-usuario-v1'). Cada pessoa só enxerga e altera os seus.
-- ---------------------------------------------------------------------------
create table if not exists public.dados_usuario (
  user_id        uuid not null references auth.users (id) on delete cascade,
  chave          text not null,
  valor          jsonb not null,
  atualizado_em  timestamptz not null default now(),
  primary key (user_id, chave)
);

alter table public.dados_usuario enable row level security;

drop policy if exists "dados_le_proprios" on public.dados_usuario;
create policy "dados_le_proprios" on public.dados_usuario
  for select to authenticated using (auth.uid() = user_id);

drop policy if exists "dados_inclui_proprios" on public.dados_usuario;
create policy "dados_inclui_proprios" on public.dados_usuario
  for insert to authenticated with check (auth.uid() = user_id);

drop policy if exists "dados_altera_proprios" on public.dados_usuario;
create policy "dados_altera_proprios" on public.dados_usuario
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "dados_apaga_proprios" on public.dados_usuario;
create policy "dados_apaga_proprios" on public.dados_usuario
  for delete to authenticated using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- 3. Eventos de pagamento: trilha de auditoria e idempotência do webhook
--    (o mesmo aviso chegando duas vezes não é processado duas vezes).
--    RLS ligada e sem nenhuma política: só a service_role acessa.
-- ---------------------------------------------------------------------------
create table if not exists public.eventos_pagamento (
  id_evento    text primary key,                 -- id do evento no provedor
  tipo         text not null,
  payload      jsonb,
  recebido_em  timestamptz not null default now()
);

alter table public.eventos_pagamento enable row level security;

-- ---------------------------------------------------------------------------
-- 4. Funções auxiliares
-- ---------------------------------------------------------------------------

-- Verdadeiro se o usuário logado tem assinatura em dia com plano igual ou maior que o pedido.
-- Será usada nas regras do Storage (dados premium) e em outras políticas.
create or replace function public.tem_plano(minimo text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.assinaturas a
    where a.user_id = auth.uid()
      and a.status in ('ativa', 'teste')
      and (a.valido_ate is null or a.valido_ate > now())
      and (a.plano = 'pro' or (a.plano = 'inicial' and minimo = 'inicial'))
  );
$$;

-- Acha o usuário pelo e-mail (usada só pelo webhook). Fechada para o navegador.
create or replace function public.usuario_por_email(p_email text)
returns uuid
language sql
stable
security definer
set search_path = public, auth
as $$
  select id from auth.users where lower(email) = lower(p_email) limit 1;
$$;

revoke all on function public.usuario_por_email(text) from public, anon, authenticated;
grant execute on function public.usuario_por_email(text) to service_role;
