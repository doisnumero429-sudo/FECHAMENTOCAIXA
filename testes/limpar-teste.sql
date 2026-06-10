-- ============================================================
-- LIMPAR DADOS DE TESTE — Fechamento de Caixa Araçá Grill
-- Cole no SQL Editor do Supabase e execute o bloco desejado.
-- A ordem respeita as chaves estrangeiras (filhos primeiro).
-- ============================================================

-- ─── OPÇÃO A: apagar TUDO (reset completo para testes) ──────────────────────
delete from public.caixa_fechamento_resumo;
delete from public.caixa_aprovacoes;
delete from public.caixa_fechamento_pagamentos;   -- cascata também cobriria, mas explícito não custa
delete from public.caixa_fechamentos;
delete from public.caixa_nfce_eventos;
delete from public.caixa_sangrias;
delete from public.caixa_cancelamentos;
delete from public.caixa_pedidos_foto;

-- ─── OPÇÃO B: apagar só um dia ──────────────────────────────────────────────
-- Troque a data e descomente (remova os "--") as linhas abaixo.
-- delete from public.caixa_fechamento_resumo where data_turno = '2026-06-10';
-- delete from public.caixa_aprovacoes where fechamento_id in (
--   select id from public.caixa_fechamentos where data_movimento = '2026-06-10');
-- delete from public.caixa_fechamentos where data_movimento = '2026-06-10';  -- cascata: pagamentos
-- delete from public.caixa_nfce_eventos where data_turno = '2026-06-10';
-- delete from public.caixa_sangrias where data_turno = '2026-06-10';
-- delete from public.caixa_cancelamentos where data_turno = '2026-06-10';

-- ─── OPÇÃO C: apagar só os fechamentos, mantendo os dados do agente ─────────
-- delete from public.caixa_fechamento_resumo;
-- delete from public.caixa_aprovacoes;
-- delete from public.caixa_fechamentos;   -- cascata: pagamentos
