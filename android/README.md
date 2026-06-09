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

- Android Studio Hedgehog ou superior
- Android 8.0 (API 26) ou superior
- Permissão de câmera e internet

## Configuração

1. Abra a pasta `android/` no Android Studio (File → Open → selecionar esta pasta)
2. Aguarde o Gradle sincronizar
3. Se tiver mais de um caixa, edite `TERMINAL_ID` em `app/build.gradle.kts`:
   ```
   buildConfigField("String", "TERMINAL_ID", "\"CAIXA_2\"")
   ```
4. Build → Run no dispositivo (celular físico com cabo USB ou Wi-Fi Debug)

## Build de produção

1. Build → Generate Signed Bundle / APK
2. Instalar o APK no celular da empresa

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
