import { state, DEFAULT_FORMS, clone, uid, activeForms } from './state.js'
import { money, esc, norm, toast } from './ui.js'
import { saveConfigCloud, syncFromCloud } from './supabase.js'

export const SQL_TEXT = `-- FECHAMENTO DE CAIXA ARAÇÁ GRILL — Schema completo
-- Cole no SQL Editor do Supabase e execute.
-- Todas as operações são idempotentes (CREATE IF NOT EXISTS, INSERT ON CONFLICT DO NOTHING).

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
  foto_url text,
  foto_storage_path text,
  device_token text,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

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

-- Tabela de campos OCR extraídos
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

-- Tabela de templates OCR (aprendizado)
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

-- Tabela de correções OCR (base para aprendizado)
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

-- Dados iniciais
insert into public.caixa_formas_pagamento
(id, nome, tipo, ativo, ordem, aparece_no_fechamento, aceita_ia, aceita_manual, entra_total, origem_preferencial, aliases_ia, aliases_totvs)
values
('credito','Crédito','cartao',true,1,true,true,true,true,'ia',array['CRED','CREDITO','CRÉDITO'],array['CREDITO','CARTAO CREDITO']),
('debito','Débito','cartao',true,2,true,true,true,true,'ia',array['DEB','DEBITO','DÉBITO'],array['DEBITO','CARTAO DEBITO']),
('pix','Pix','pix',true,3,true,true,true,true,'manual',array['PIX'],array['PIX']),
('voucher','Voucher','voucher',true,4,true,true,true,true,'ia',array['VOUCHER','VALE','VR','SODEXO','ALELO'],array['VOUCHER']),
('assinadas','Assinadas','fiado',true,5,true,false,true,true,'agente',array['ASSINADA','FIADO'],array['ASSINADAS']),
('ifood','iFood','delivery',true,6,true,false,true,true,'manual',array['IFOOD','I-FOOD'],array['IFOOD'])
on conflict (id) do nothing;

insert into public.caixa_turnos (id, nome, ativo, ordem)
values ('almoco','Almoço',true,1),('noite','Noite',true,2)
on conflict (id) do nothing;

insert into public.caixa_operadores (id, nome, ativo, ordem)
values ('operador_padrao','Operador',true,1)
on conflict (id) do nothing;

-- Bucket de fotos
insert into storage.buckets (id, name, public)
values ('relatorios-caixa','relatorios-caixa',true)
on conflict (id) do nothing;

-- RLS — habilitar em todas as tabelas
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

-- Políticas RLS por tabela
-- Config (gerenciadas pelo PWA): abertas para leitura e escrita
do $$ begin create policy caixa_formas_all on public.caixa_formas_pagamento for all using (true) with check (true); exception when duplicate_object then null; end $$;
do $$ begin create policy caixa_operadores_all on public.caixa_operadores for all using (true) with check (true); exception when duplicate_object then null; end $$;
do $$ begin create policy caixa_turnos_all on public.caixa_turnos for all using (true) with check (true); exception when duplicate_object then null; end $$;

-- Fechamentos: leitura e inserção livres; edição/exclusão apenas service_role
do $$ begin create policy caixa_fech_select on public.caixa_fechamentos for select using (true); exception when duplicate_object then null; end $$;
do $$ begin create policy caixa_fech_insert on public.caixa_fechamentos for insert with check (true); exception when duplicate_object then null; end $$;
do $$ begin create policy caixa_fech_update on public.caixa_fechamentos for update using (auth.jwt()->>'role' = 'service_role'); exception when duplicate_object then null; end $$;
do $$ begin create policy caixa_fech_delete on public.caixa_fechamentos for delete using (auth.jwt()->>'role' = 'service_role'); exception when duplicate_object then null; end $$;

do $$ begin create policy caixa_pag_select on public.caixa_fechamento_pagamentos for select using (true); exception when duplicate_object then null; end $$;
do $$ begin create policy caixa_pag_insert on public.caixa_fechamento_pagamentos for insert with check (true); exception when duplicate_object then null; end $$;
do $$ begin create policy caixa_pag_update on public.caixa_fechamento_pagamentos for update using (auth.jwt()->>'role' = 'service_role'); exception when duplicate_object then null; end $$;
do $$ begin create policy caixa_pag_delete on public.caixa_fechamento_pagamentos for delete using (auth.jwt()->>'role' = 'service_role'); exception when duplicate_object then null; end $$;

-- Pedidos de foto: leitura, inserção e atualização livres (Android precisa atualizar)
do $$ begin create policy caixa_pedidos_all on public.caixa_pedidos_foto for all using (true) with check (true); exception when duplicate_object then null; end $$;

-- OCR e auditoria: inserção livre; edição apenas service_role
do $$ begin create policy caixa_ocr_ext_select on public.caixa_ocr_extracoes for select using (true); exception when duplicate_object then null; end $$;
do $$ begin create policy caixa_ocr_ext_insert on public.caixa_ocr_extracoes for insert with check (true); exception when duplicate_object then null; end $$;
do $$ begin create policy caixa_ocr_campos_all on public.caixa_ocr_campos for all using (true) with check (true); exception when duplicate_object then null; end $$;
do $$ begin create policy caixa_ocr_corr_all on public.caixa_ocr_correcoes for all using (true) with check (true); exception when duplicate_object then null; end $$;
do $$ begin create policy caixa_ocr_templ_all on public.caixa_ocr_templates for all using (true) with check (true); exception when duplicate_object then null; end $$;
do $$ begin create policy caixa_audit_select on public.caixa_auditoria for select using (true); exception when duplicate_object then null; end $$;
do $$ begin create policy caixa_audit_insert on public.caixa_auditoria for insert with check (true); exception when duplicate_object then null; end $$;

-- Storage
do $$ begin create policy relatorios_caixa_read on storage.objects for select using (bucket_id = 'relatorios-caixa'); exception when duplicate_object then null; end $$;
do $$ begin create policy relatorios_caixa_upload on storage.objects for insert with check (bucket_id = 'relatorios-caixa'); exception when duplicate_object then null; end $$;
`

export function renderConfig() {
  renderList('operatorsList', state.operators, 'operator')
  renderList('shiftsList', state.shifts, 'shift')
  renderForms()
  updateConfigCounters()

  const sqlBox = document.getElementById('sqlBox')
  if (sqlBox) sqlBox.value = SQL_TEXT
}

function renderList(id, list, kind) {
  const el = document.getElementById(id)
  if (!el) return
  el.innerHTML = list.slice().sort((a, b) => (a.ordem || 999) - (b.ordem || 999)).map(x =>
    `<div class="config">
      <div class="grid g3">
        <div class="field">
          <label>${kind === 'operator' ? 'Operador' : 'Turno'}</label>
          <input value="${esc(x.nome)}" onchange="window.__config.updSimple('${kind}','${x.id}','nome',this.value)">
        </div>
        <label style="align-self:end">
          <input type="checkbox" ${x.ativo ? 'checked' : ''} onchange="window.__config.updSimple('${kind}','${x.id}','ativo',this.checked)"> Ativo
        </label>
        <div class="btns" style="align-self:end">
          <button class="btn light small" onclick="window.__config.moveSimple('${kind}','${x.id}',-1)">↑</button>
          <button class="btn light small" onclick="window.__config.moveSimple('${kind}','${x.id}',1)">↓</button>
          <button class="btn danger small" onclick="window.__config.removeSimple('${kind}','${x.id}')">Remover</button>
        </div>
      </div>
    </div>`
  ).join('')
}

function renderForms() {
  const el = document.getElementById('formsList')
  if (!el) return
  el.innerHTML = state.forms.slice().sort((a, b) => (a.ordem || 999) - (b.ordem || 999)).map(f =>
    `<div class="config">
      <div class="grid g3">
        <div class="field"><label>Nome</label>
          <input value="${esc(f.nome)}" onchange="window.__config.updForm('${f.id}','nome',this.value)">
        </div>
        <div class="field"><label>Tipo</label>
          <select onchange="window.__config.updForm('${f.id}','tipo',this.value)">
            ${[['cartao','Cartão'],['pix','Pix'],['voucher','Voucher'],['delivery','Delivery'],['fiado','Fiado'],['outro','Outro']].map(([v,l]) =>
              `<option value="${v}" ${f.tipo === v ? 'selected' : ''}>${l}</option>`
            ).join('')}
          </select>
        </div>
        <div class="field"><label>Origem</label>
          <select onchange="window.__config.updForm('${f.id}','origem',this.value)">
            ${[['manual','Manual'],['ia','Automático'],['agente','Agente']].map(([v,l]) =>
              `<option value="${v}" ${f.origem === v ? 'selected' : ''}>${l}</option>`
            ).join('')}
          </select>
        </div>
      </div>
      <div class="grid g3" style="margin-top:10px">
        <label><input type="checkbox" ${f.ativo ? 'checked' : ''} onchange="window.__config.updForm('${f.id}','ativo',this.checked)"> Ativo</label>
        <label><input type="checkbox" ${f.ia ? 'checked' : ''} onchange="window.__config.updForm('${f.id}','ia',this.checked)"> Preenchido automaticamente</label>
        <label><input type="checkbox" ${f.aparece ? 'checked' : ''} onchange="window.__config.updForm('${f.id}','aparece',this.checked)"> Aparece no fechamento</label>
      </div>
      <div class="field" style="margin-top:10px">
        <label>Termos reconhecidos na foto (separados por vírgula)</label>
        <input value="${esc((f.aliases || []).join(', '))}" onchange="window.__config.updAliases('${f.id}',this.value)">
      </div>
      <div class="btns" style="margin-top:10px">
        <button class="btn light small" onclick="window.__config.moveForm('${f.id}',-1)">↑ Subir</button>
        <button class="btn light small" onclick="window.__config.moveForm('${f.id}',1)">↓ Descer</button>
        <button class="btn danger small" onclick="window.__config.removeForm('${f.id}')">Remover</button>
      </div>
    </div>`
  ).join('')
}

export function updateConfigCounters() {
  const op = document.getElementById('operatorsCount')
  const sh = document.getElementById('shiftsCount')
  const fo = document.getElementById('formsCount')
  if (op) op.textContent = `${state.operators.filter(x => x.ativo).length} ativos · ${state.operators.length} total`
  if (sh) sh.textContent = `${state.shifts.filter(x => x.ativo).length} ativos · ${state.shifts.length} total`
  if (fo) fo.textContent = `${state.forms.filter(x => x.ativo && x.aparece).length} no fechamento · ${state.forms.length} total`
}

function listFor(kind) { return kind === 'operator' ? state.operators : state.shifts }
function setList(kind, l) { if (kind === 'operator') state.operators = l; else state.shifts = l }

export function updSimple(k, id, f, v) {
  const x = listFor(k).find(i => i.id === id)
  if (x) x[f] = v
  renderConfig()
  const { render } = window.__appRender || {}
  render && render()
}

export function moveSimple(k, id, dir) {
  const l = listFor(k).slice().sort((a, b) => (a.ordem || 999) - (b.ordem || 999))
  const i = l.findIndex(x => x.id === id), j = i + dir
  if (j < 0 || j >= l.length) return
  ;[l[i], l[j]] = [l[j], l[i]]
  l.forEach((x, idx) => x.ordem = idx + 1)
  setList(k, l)
  renderConfig()
  const { render } = window.__appRender || {}
  render && render()
}

export function removeSimple(k, id) {
  if (!confirm('Remover? Você também pode só desativar.')) return
  setList(k, listFor(k).filter(x => x.id !== id))
  renderConfig()
  const { render } = window.__appRender || {}
  render && render()
}

export function addOperator() {
  const el = document.getElementById('newOperator')
  const nome = el.value.trim()
  if (!nome) return toast('Informe o operador.')
  state.operators.push({ id: norm(nome) || uid('op'), nome, ativo: true, ordem: state.operators.length + 1 })
  el.value = ''
  renderConfig()
  const { render } = window.__appRender || {}
  render && render()
}

export function addShift() {
  const el = document.getElementById('newShift')
  const nome = el.value.trim()
  if (!nome) return toast('Informe o turno.')
  state.shifts.push({ id: norm(nome) || uid('turno'), nome, ativo: true, ordem: state.shifts.length + 1 })
  el.value = ''
  renderConfig()
  const { render } = window.__appRender || {}
  render && render()
}

export function updForm(id, f, v) {
  const x = state.forms.find(i => i.id === id)
  if (!x) return
  x[f] = v
  if (f === 'origem') x.ia = v === 'ia'
  const { render } = window.__appRender || {}
  const { hydrate } = window.__stateHelpers || {}
  hydrate && hydrate()
  renderForms()
  render && render()
}

export function updAliases(id, v) {
  const x = state.forms.find(i => i.id === id)
  if (x) x.aliases = v.split(',').map(s => s.trim()).filter(Boolean)
}

export function moveForm(id, dir) {
  const l = state.forms.slice().sort((a, b) => (a.ordem || 999) - (b.ordem || 999))
  const i = l.findIndex(x => x.id === id), j = i + dir
  if (j < 0 || j >= l.length) return
  ;[l[i], l[j]] = [l[j], l[i]]
  l.forEach((x, idx) => x.ordem = idx + 1)
  state.forms = l
  renderConfig()
  const { render } = window.__appRender || {}
  render && render()
}

export function removeForm(id) {
  if (!confirm('Remover forma? Você também pode só desativar.')) return
  state.forms = state.forms.filter(f => f.id !== id)
  const { hydrate } = window.__stateHelpers || {}
  hydrate && hydrate()
  renderConfig()
  const { render } = window.__appRender || {}
  render && render()
}

export function addForm() {
  const nome = document.getElementById('newForm').value.trim()
  if (!nome) return toast('Informe o nome.')
  const origem = document.getElementById('newFormOrigin').value
  state.forms.push({
    id: norm(nome) || uid('forma'),
    nome,
    tipo: document.getElementById('newFormType').value,
    ativo: true,
    ordem: state.forms.length + 1,
    aparece: true,
    ia: origem === 'ia',
    origem,
    aliases: [nome]
  })
  document.getElementById('newForm').value = ''
  const { hydrate } = window.__stateHelpers || {}
  hydrate && hydrate()
  renderConfig()
  const { render } = window.__appRender || {}
  render && render()
}

export function resetForms() {
  if (confirm('Restaurar formas padrão?')) {
    state.forms = clone(DEFAULT_FORMS)
    const { hydrate } = window.__stateHelpers || {}
    hydrate && hydrate()
    renderConfig()
    const { render } = window.__appRender || {}
    render && render()
  }
}

export function toggleConfigSections(open) {
  document.querySelectorAll('#page-config details.config-section').forEach(d => d.open = open)
}

export function copySql() {
  navigator.clipboard?.writeText(SQL_TEXT)
  toast('Configuração copiada.')
}

export async function saveConfig() {
  const ok = await saveConfigCloud()
  if (ok) {
    await syncFromCloud()
    renderConfig()
    const { render } = window.__appRender || {}
    render && render()
  }
}
