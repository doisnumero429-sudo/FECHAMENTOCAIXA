# Fechamento de Caixa — Araçá Grill

Sistema de fechamento de caixa profissional. PWA instalável, Supabase na nuvem, app Android para foto da maquininha.

---

## 1. Configurar o Supabase

1. Acesse [supabase.com](https://supabase.com) → seu projeto → **SQL Editor**
2. Cole o conteúdo de `supabase/schema.sql` e clique em **Run**
3. Pronto! O banco, as tabelas, o bucket de fotos e as permissões estão criados.

> O SQL é idempotente: pode rodar várias vezes sem problema.

---

## 2. Rodar localmente

```bash
# Instalar dependências
npm install

# Criar arquivo de variáveis de ambiente
cp .env.example .env
# Edite .env com suas credenciais do Supabase

# Iniciar servidor de desenvolvimento
npm run dev
```

Acesse: `http://localhost:5173`

---

## 3. Deploy na Vercel

1. Faça push deste projeto para um repositório GitHub
2. Acesse [vercel.com](https://vercel.com) → **Add New Project** → selecione o repositório
3. Na seção **Environment Variables**, adicione:
   - `VITE_SUPABASE_URL` → sua URL do Supabase (ex: `https://xxx.supabase.co`)
   - `VITE_SUPABASE_ANON_KEY` → sua chave anon/public do Supabase
4. Clique em **Deploy**

> O `vercel.json` já está configurado para SPA (rota única).

---

## 4. PWA — Instalar como app

Após o deploy na Vercel:
1. Abra o site no Chrome (celular ou desktop)
2. Clique no ícone de instalar na barra de endereço (ou menu → "Instalar app")
3. O app aparece na tela inicial/área de trabalho

---

## 5. App Android "Meu Caixa"

Serve apenas para tirar a foto do relatório da maquininha.

1. Abra a pasta `android/` no Android Studio
2. Aguarde o Gradle sincronizar
3. Conecte o celular da empresa via USB
4. Clique em Run ▶️

> Veja instruções detalhadas em `android/README.md`

---

## 6. Agente de impressora (Windows)

Captura trabalhos de impressão para análise futura.

```bat
pip install pywin32 wmi
# Copie e edite config.json
python agente-impressao/agente.py
```

> Veja instruções em `agente-impressao/README.md`

---

## Estrutura do projeto

```
FECHAMENTOCAIXA/
├── src/
│   ├── main.js          # Boot e event wiring
│   ├── state.js         # Estado global e cálculos
│   ├── supabase.js      # Toda I/O com o Supabase
│   ├── wizard.js        # As 7 etapas do fechamento
│   ├── ocr.js           # Leitura automática por Tesseract.js
│   ├── photo-request.js # Pedido de foto para o app Android
│   ├── config.js        # Página de configurações
│   ├── history.js       # Página de conferência/histórico
│   ├── ui.js            # Utilidades visuais
│   └── style.css        # Visual premium
├── supabase/
│   └── schema.sql       # Estrutura completa do banco
├── android/             # App Kotlin "Meu Caixa"
├── agente-impressao/    # Agente Python para Windows
├── public/              # Ícones e favicon
├── index.html           # Shell da aplicação
├── vite.config.js       # Build + PWA
└── vercel.json          # Deploy Vercel
```

---

## Como testar cada cenário

| Cenário | Como fazer |
|---------|-----------|
| Fechamento normal | Preencher etapas 1→7, clicar "Fechar caixa e salvar" |
| Abertura divergente | Informar valor diferente do troco final anterior no mesmo terminal |
| Avanço sem foto | Na etapa 2, clicar "Continuar sem foto →" |
| Upload de foto manual | Na etapa 2, abrir "Enviar foto manualmente" e selecionar imagem |
| Fechamento com diferença | Na etapa 6, marcar "Sim, teve diferença" e preencher explicação |
| Conferência com foto | Ir em Conferência → encontrar fechamento → clicar "Ver foto" |
| PWA instalado | Abrir no Chrome → ícone de instalar na barra de endereço |

---

## Regras do sistema

- **Nunca salva dados financeiros localmente** — tudo vai para o Supabase
- **Se o Supabase falhar**, o sistema avisa e não finge ter salvo
- **OCR gratuito** com Tesseract.js — sem IA paga
- **Troco final = dinheiro contado** (o que ficou na gaveta vai para o próximo turno)
- **Dinheiro para TOTVS** = dinheiro contado − abertura + sangria troco
