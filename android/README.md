# Meu Caixa — App Android

Aplicativo simples para tirar foto do relatório da maquininha de cartão.

## Como funciona

1. O app fica em tela de espera
2. Quando o funcionário chega na etapa da maquininha no PWA, o PWA cria um pedido de foto no Supabase
3. O app detecta o pedido e abre a câmera automaticamente
4. Funcionário tira a foto e confirma nitidez
5. App envia para o Supabase Storage e marca pedido como recebido
6. PWA detecta a foto e continua automaticamente

## Requisitos

- Android 8.0 (API 26) ou superior
- Permissão de câmera e internet

## Como instalar (sem Android Studio)

O APK é gerado automaticamente pelo GitHub Actions a cada atualização:

1. Acesse **Releases** no repositório do GitHub
2. Baixe o arquivo `MeuCaixa-YYYY-MM-DD.apk`
3. Transfira para o celular (WhatsApp, cabo USB, Google Drive)
4. No celular: **Configurações → Segurança → Instalar apps desconhecidos**
5. Abra o `.apk` e instale
6. Abra **Meu Caixa** — ele fica aguardando automaticamente

## Configuração (múltiplos caixas)

Se tiver mais de um caixa, edite `TERMINAL_ID` em `app/build.gradle.kts`:
```
buildConfigField("String", "TERMINAL_ID", "\"CAIXA_2\"")
```

## Estrutura dos arquivos

```
app/src/main/java/br/com/aracaresto/meucaixa/
├── MainActivity.kt              # Tela de espera + orquestração
├── data/
│   ├── SupabaseClient.kt        # Configuração do Supabase
│   └── PedidoFotoRepository.kt  # Lógica de polling e upload
└── ui/
    └── CameraScreen.kt          # Câmera, preview, confirmação
```
