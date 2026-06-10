-- ============================================================
-- FECHAMENTO DE CAIXA ARAÇÁ GRILL — Schema completo v2
-- Cole no SQL Editor do Supabase e execute.
-- Todas as operações são idempotentes.
-- ============================================================

-- Tabela de formas de pagamento
create table if not exists public.caixa_formas_pagamento (
  id text primary key,
  nome text not null,
  tipo text not null default 'outro',
  ativo boolean not null default true,
  ordem int not null default 999,
  aparece_no_fechamento boolean not null default true,
  aceita_ia boolean not null default false,
  aceita_manual boolean not null default true,
  entra_total boolean not null default true,
  origem_preferencial text not null default 'manual',
  aliases_ia text[] default '{}',
  aliases_totvs text[] default '{}',
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

-- Tabela de operadores
create table if not exists public.caixa_operadores (
  id text primary key,
  nome text not null,
  ativo boolean not null default true,
  ordem int not null default 999,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

-- Tabela de turnos
create table if not exists public.caixa_turnos (
  id text primary key,
  nome text not null,
  ativo boolean not null default true,
  ordem int not null default 999,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

-- Tabela de fechamentos
create table if not exists public.caixa_fechamentos (
  id text primary key,
  data_movimento date not null,
  turno text,
  operador text,
  terminal text not null default 'CAIXA',
  status text not null default 'fechado',
  abertura_informada numeric(12,2) not null default 0,
  abertura_bateu_com_anterior boolean,
  abertura_confirmada_com_divergencia boolean not null default false,
  foto_maquininha_url text,
  foto_maquininha_nome text,
  dinheiro_contado numeric(12,2) not null default 0,
  sangria_troco numeric(12,2) not null default 0,
  dinheiro_lancar_totvs numeric(12,2) not null default 0,
  troco_final_deixado numeric(12,2),
  houve_diferenca_totvs boolean not null default false,
  observacao_diferenca text,
  alertas jsonb not null default '[]'::jsonb,
  payload jsonb not null default '{}'::jsonb,
  criado_em timestamptz not null default now()
);

-- Índice para busca por terminal + data
create index if not exists idx_fechamentos_terminal_data
  on public.caixa_fechamentos(terminal, data_movimento desc);

-- Tabela de pagamentos por fechamento
create table if not exists public.caixa_fechamento_pagamentos (
  id text primary key,
  fechamento_id text not null references public.caixa_fechamentos(id) on delete cascade,
  forma_pagamento_id text,
  nome_forma text not null,
  valor_lido_ia numeric(12,2),
  valor_confirmado numeric(12,2) not null default 0,
  confirmado boolean not null default false,
  editado boolean not null default false,
  origem text not null default 'manual',
  observacao text,
  ordem int not null default 999,
  criado_em timestamptz not null default now()
);

-- Tabela de pedidos de foto (PWA → Android)
create table if not exists public.caixa_pedidos_foto (
  id text primary key,
  fechamento_id text not null,
  terminal text not null default 'CAIXA',
  status text not null default 'aguardando',
  -- status: aguardando | foto_recebida | cancelado | erro
  foto_url text,
  foto_storage_path text,
  device_token text,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

-- Índice para o Android buscar pedidos pendentes por terminal
create index if not exists idx_pedidos_foto_status_terminal
  on public.caixa_pedidos_foto(status, terminal);

-- Tabela de extrações OCR
create table if not exists public.caixa_ocr_extracoes (
  id text primary key,
  fechamento_id text not null references public.caixa_fechamentos(id) on delete cascade,
  pedido_foto_id text references public.caixa_pedidos_foto(id),
  motor text not null default 'tesseract-v5',
  texto_bruto text,
  confianca numeric(5,2),
  duracao_ms int,
  criado_em timestamptz not null default now()
);

-- Tabela de campos OCR extraídos individualmente
create table if not exists public.caixa_ocr_campos (
  id text primary key,
  extracao_id text not null references public.caixa_ocr_extracoes(id) on delete cascade,
  forma_pagamento_id text,
  nome_campo text not null,
  valor_lido numeric(12,2),
  confianca numeric(5,2),
  linha_origem text,
  criado_em timestamptz not null default now()
);

-- Tabela de templates OCR (para aprendizado futuro)
create table if not exists public.caixa_ocr_templates (
  id text primary key,
  terminal text not null default 'CAIXA',
  nome text not null,
  padrao_regex text,
  forma_pagamento_id text,
  usos int not null default 0,
  ultima_vez timestamptz,
  criado_em timestamptz not null default now()
);

-- Tabela de correções manuais OCR (base para aprendizado)
create table if not exists public.caixa_ocr_correcoes (
  id text primary key,
  campo_id text references public.caixa_ocr_campos(id),
  forma_pagamento_id text,
  valor_original numeric(12,2),
  valor_corrigido numeric(12,2),
  linha_origem text,
  criado_em timestamptz not null default now()
);

-- Tabela de auditoria
create table if not exists public.caixa_auditoria (
  id text primary key default gen_random_uuid()::text,
  tabela text not null,
  operacao text not null,
  registro_id text,
  dados_antes jsonb,
  dados_depois jsonb,
  ip_origem text,
  criado_em timestamptz not null default now()
);

-- ─── Dados iniciais ───────────────────────────────────────────────────────────

insert into public.caixa_formas_pagamento
(id, nome, tipo, ativo, ordem, aparece_no_fechamento, aceita_ia, aceita_manual, entra_total, origem_preferencial, aliases_ia, aliases_totvs)
values
('credito','Crédito','cartao',true,1,true,true,true,true,'ia',
  array['CRED','CREDITO','CRÉDITO'],array['CREDITO','CARTAO CREDITO']),
('debito','Débito','cartao',true,2,true,true,true,true,'ia',
  array['DEB','DEBITO','DÉBITO'],array['DEBITO','CARTAO DEBITO']),
('pix','Pix','pix',true,3,true,true,true,true,'manual',
  array['PIX'],array['PIX']),
('voucher','Voucher','voucher',true,4,true,true,true,true,'ia',
  array['VOUCHER','VALE','VR','SODEXO','ALELO'],array['VOUCHER']),
('assinadas','Assinadas','fiado',true,5,true,false,true,true,'agente',
  array['ASSINADA','FIADO'],array['ASSINADAS']),
('ifood','iFood','delivery',true,6,true,false,true,true,'manual',
  array['IFOOD','I-FOOD'],array['IFOOD'])
on conflict (id) do nothing;

insert into public.caixa_turnos (id, nome, ativo, ordem)
values ('almoco','Almoço',true,1),('noite','Noite',true,2)
on conflict (id) do nothing;

insert into public.caixa_operadores (id, nome, ativo, ordem)
values ('operador_padrao','Operador',true,1)
on conflict (id) do nothing;

-- ─── Bucket de fotos ─────────────────────────────────────────────────────────

insert into storage.buckets (id, name, public)
values ('relatorios-caixa','relatorios-caixa',true)
on conflict (id) do nothing;

-- ─── Row Level Security ──────────────────────────────────────────────────────

alter table public.caixa_formas_pagamento enable row level security;
alter table public.caixa_operadores enable row level security;
alter table public.caixa_turnos enable row level security;
alter table public.caixa_fechamentos enable row level security;
alter table public.caixa_fechamento_pagamentos enable row level security;
alter table public.caixa_pedidos_foto enable row level security;
alter table public.caixa_ocr_extracoes enable row level security;
alter table public.caixa_ocr_campos enable row level security;
alter table public.caixa_ocr_templates enable row level security;
alter table public.caixa_ocr_correcoes enable row level security;
alter table public.caixa_auditoria enable row level security;

-- Config: totalmente aberto (gerenciado pelos funcionários via PWA)
do $$ begin create policy caixa_formas_all on public.caixa_formas_pagamento for all using (true) with check (true); exception when duplicate_object then null; end $$;
do $$ begin create policy caixa_operadores_all on public.caixa_operadores for all using (true) with check (true); exception when duplicate_object then null; end $$;
do $$ begin create policy caixa_turnos_all on public.caixa_turnos for all using (true) with check (true); exception when duplicate_object then null; end $$;

-- Fechamentos: leitura e inserção livres; edição/exclusão bloqueadas para anon
do $$ begin create policy caixa_fech_select on public.caixa_fechamentos for select using (true); exception when duplicate_object then null; end $$;
do $$ begin create policy caixa_fech_insert on public.caixa_fechamentos for insert with check (true); exception when duplicate_object then null; end $$;
do $$ begin create policy caixa_fech_update on public.caixa_fechamentos for update using (auth.jwt()->>'role' = 'service_role'); exception when duplicate_object then null; end $$;
do $$ begin create policy caixa_fech_delete on public.caixa_fechamentos for delete using (auth.jwt()->>'role' = 'service_role'); exception when duplicate_object then null; end $$;

do $$ begin create policy caixa_pag_select on public.caixa_fechamento_pagamentos for select using (true); exception when duplicate_object then null; end $$;
do $$ begin create policy caixa_pag_insert on public.caixa_fechamento_pagamentos for insert with check (true); exception when duplicate_object then null; end $$;
do $$ begin create policy caixa_pag_update on public.caixa_fechamento_pagamentos for update using (auth.jwt()->>'role' = 'service_role'); exception when duplicate_object then null; end $$;
do $$ begin create policy caixa_pag_delete on public.caixa_fechamento_pagamentos for delete using (auth.jwt()->>'role' = 'service_role'); exception when duplicate_object then null; end $$;

-- Pedidos de foto: totalmente abertos (Android usa anon key para atualizar)
do $$ begin create policy caixa_pedidos_all on public.caixa_pedidos_foto for all using (true) with check (true); exception when duplicate_object then null; end $$;

-- OCR: inserção livre; leitura livre; edição bloqueada
do $$ begin create policy caixa_ocr_ext_select on public.caixa_ocr_extracoes for select using (true); exception when duplicate_object then null; end $$;
do $$ begin create policy caixa_ocr_ext_insert on public.caixa_ocr_extracoes for insert with check (true); exception when duplicate_object then null; end $$;
do $$ begin create policy caixa_ocr_campos_all on public.caixa_ocr_campos for all using (true) with check (true); exception when duplicate_object then null; end $$;
do $$ begin create policy caixa_ocr_corr_all on public.caixa_ocr_correcoes for all using (true) with check (true); exception when duplicate_object then null; end $$;
do $$ begin create policy caixa_ocr_templ_all on public.caixa_ocr_templates for all using (true) with check (true); exception when duplicate_object then null; end $$;

-- Auditoria: inserção e leitura livres; nunca edita/apaga
do $$ begin create policy caixa_audit_select on public.caixa_auditoria for select using (true); exception when duplicate_object then null; end $$;
do $$ begin create policy caixa_audit_insert on public.caixa_auditoria for insert with check (true); exception when duplicate_object then null; end $$;

-- Storage
do $$ begin create policy relatorios_caixa_read on storage.objects for select using (bucket_id = 'relatorios-caixa'); exception when duplicate_object then null; end $$;
do $$ begin create policy relatorios_caixa_upload on storage.objects for insert with check (bucket_id = 'relatorios-caixa'); exception when duplicate_object then null; end $$;

-- ─── Eventos do agente de impressora ────────────────────────────────────────
-- Estas tabelas são alimentadas pelo agente Windows (agente-impressao/agente.py)
-- em tempo real conforme documentos são impressos na impressora CAIXA.

-- NFC-e (Cupom Fiscal Eletrônico) — cada mesa fechada
create table if not exists public.caixa_nfce_eventos (
  id uuid default gen_random_uuid() primary key,
  created_at timestamptz not null default now(),
  data_hora timestamptz not null,
  data_turno date not null,
  mesa text,
  pedido text,
  valor_total numeric(10,2),
  gorjeta numeric(10,2),
  -- credito | debito | pix | dinheiro | outros
  forma_pagamento text,
  raw_text text,
  job_id integer,
  -- sha256 do SPL garante idempotência: reiniciar o agente não gera duplicatas
  sha256 text unique
);

create index if not exists idx_nfce_turno on public.caixa_nfce_eventos(data_turno desc);

-- Sangrias — pagamentos de extras, músicos, retiradas cofre
create table if not exists public.caixa_sangrias (
  id uuid default gen_random_uuid() primary key,
  created_at timestamptz not null default now(),
  data_hora timestamptz not null,
  data_turno date not null,
  operador text,
  motivo text,
  valor numeric(10,2),
  -- musico | extra | vale | cofre | outro (auto-classificado pelo agente via motivo)
  -- vale  = adiantamento de salário para funcionário fixo
  -- extra = freelancer ou funcionário em sua folga trabalhando
  tipo text not null default 'outro' check (tipo in ('musico', 'extra', 'vale', 'cofre', 'outro')),
  -- true quando o operador confirmar/ajustar a classificação no fechamento
  confirmado boolean not null default false,
  job_id integer,
  sha256 text unique
);

create index if not exists idx_sangrias_turno on public.caixa_sangrias(data_turno desc);

-- Cancelamentos de produto
create table if not exists public.caixa_cancelamentos (
  id uuid default gen_random_uuid() primary key,
  created_at timestamptz not null default now(),
  data_hora timestamptz not null,
  data_turno date not null,
  mesa text,
  operador text,
  motivo text,
  produto text,
  qtde numeric(8,3),
  valor numeric(10,2),
  job_id integer,
  sha256 text unique
);

create index if not exists idx_cancelamentos_turno on public.caixa_cancelamentos(data_turno desc);

-- RLS: leitura e inserção livres (agente usa anon key); edição/exclusão bloqueadas
alter table public.caixa_nfce_eventos enable row level security;
alter table public.caixa_sangrias enable row level security;
alter table public.caixa_cancelamentos enable row level security;

do $$ begin create policy nfce_select on public.caixa_nfce_eventos for select using (true); exception when duplicate_object then null; end $$;
do $$ begin create policy nfce_insert on public.caixa_nfce_eventos for insert with check (true); exception when duplicate_object then null; end $$;
do $$ begin create policy nfce_update on public.caixa_nfce_eventos for update using (auth.jwt()->>'role' = 'service_role'); exception when duplicate_object then null; end $$;
do $$ begin create policy nfce_delete on public.caixa_nfce_eventos for delete using (auth.jwt()->>'role' = 'service_role'); exception when duplicate_object then null; end $$;

do $$ begin create policy sangrias_select on public.caixa_sangrias for select using (true); exception when duplicate_object then null; end $$;
do $$ begin create policy sangrias_insert on public.caixa_sangrias for insert with check (true); exception when duplicate_object then null; end $$;
-- UPDATE aberto para que o wizard possa confirmar/reclassificar a sangria
do $$ begin create policy sangrias_update on public.caixa_sangrias for update using (true); exception when duplicate_object then null; end $$;
do $$ begin create policy sangrias_delete on public.caixa_sangrias for delete using (auth.jwt()->>'role' = 'service_role'); exception when duplicate_object then null; end $$;

do $$ begin create policy cancel_select on public.caixa_cancelamentos for select using (true); exception when duplicate_object then null; end $$;
do $$ begin create policy cancel_insert on public.caixa_cancelamentos for insert with check (true); exception when duplicate_object then null; end $$;
do $$ begin create policy cancel_update on public.caixa_cancelamentos for update using (auth.jwt()->>'role' = 'service_role'); exception when duplicate_object then null; end $$;
do $$ begin create policy cancel_delete on public.caixa_cancelamentos for delete using (auth.jwt()->>'role' = 'service_role'); exception when duplicate_object then null; end $$;
