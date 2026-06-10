# Ferramentas de teste

Para testar o fechamento e a conciliação **sem precisar imprimir de verdade** na impressora.

## `gerador-teste.html` — simula o agente

Abre no navegador (duplo-clique no arquivo, ou arraste pra uma aba). Não precisa instalar nada.

Ele insere **NFC-e, sangrias e cancelamentos falsos** no Supabase — exatamente o que o agente da
impressora faria. Depois você abre o app e faz o fechamento normalmente; a conciliação vai comparar
o que você digitar com esses dados.

### Como usar
1. Abra `gerador-teste.html`. A URL e a anon key já vêm preenchidas (a anon key é pública).
2. Escolha **a data e o turno** (use a mesma data na Etapa 1 do fechamento).
3. Clique em um **cenário**. Ele insere os NFC-e e mostra **exatamente o que digitar** no fechamento
   e **qual resultado esperar**.
4. (Opcional) Gere **sangrias** e **cancelamentos** para ver na Etapa 5.
5. Abra o app, faça o fechamento com os valores sugeridos e confira o resultado na Etapa 7.

### Cenários
| Cenário | O que testa |
|---|---|
| ✅ Caixa certinho | Tudo bate — nenhum alerta |
| 🔄 Troca Crédito↔Débito | Motor de compensação (alta confiança) + botão "Usar como explicação" |
| 📱 PIX não registrado | Insight de PIX a mais, status pendente |
| 🪙 Diferença de centavos | Tolerância configurável (fica verde) |
| ⚠️ Diferença grande | Status pendente → abre o painel de aprovação do gerente |

> Dica: para o **dinheiro** bater, use **Abertura R$ 0,00** e conte na gaveta o valor sugerido —
> assim o "Dinheiro TOTVS" calculado fica igual ao NFC-e em dinheiro.

## `limpar-teste.sql` — apaga os dados de teste

A exclusão **não** é feita pelo app: a RLS bloqueia DELETE para a anon key (proteção de produção —
ninguém apaga fechamento pelo navegador). Por isso a limpeza vai pelo **SQL Editor do Supabase**:

1. Supabase → **SQL Editor**.
2. Cole o conteúdo de `limpar-teste.sql` (ou use o botão "Copiar SQL" dentro do gerador).
3. Rode o bloco que quiser: **tudo**, **só um dia** ou **só os fechamentos**.

## Segurança
- Estas ferramentas usam **apenas a anon key** (a mesma que já vai no app publicado).
- **Nunca** cole a `service_role` aqui nem em qualquer arquivo do frontend.
- Esta pasta é só para testes e não faz parte do app publicado na Vercel.
