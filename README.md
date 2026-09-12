# ⚽ CHB IMPORT - Bot WhatsApp (Baileys + Neon PostgreSQL + Render)

Aplicação backend completa para automação de postagens no WhatsApp da **CHB IMPORT**, desenvolvida em **Node.js 22**, com conexão direta por socket via **`@whiskeysockets/baileys`** (sem Chromium/Puppeteer, consumo de RAM ultrabaixo ~50MB) e persistência de autenticação no **Neon PostgreSQL** via **Prisma ORM**.

Construída sob medida para hospedagem como **Web Service no Render** (sem perda de sessão em deploys) com **Dashboard administrativo em Tailwind CSS**.

---

## 🏗️ Arquitetura do Sistema

```text
bot-whatsapp/
├── prisma/
│   └── schema.prisma              # Modelo Session (chave-valor de credenciais Baileys)
├── src/
│   ├── index.js                   # Ponto de entrada (Servidor, Baileys, Prisma e Cron)
│   ├── server.js                  # Servidor Express + Dashboard Web com Tailwind CSS
│   ├── workflow.js                # Orquestrador das 5 etapas de automação
│   ├── scheduler.js               # Agendador node-cron (2 vezes ao dia: 12h e 14h)
│   ├── checkSetup.js              # Diagnóstico completo de banco, Drive e IA
│   ├── config/
│   │   └── index.js               # Validação de variáveis (.env e credenciais Google)
│   ├── database/
│   │   ├── prisma.js              # Cliente Singleton do Prisma
│   │   └── prismaAuthState.js     # Adaptador de autenticação Baileys no PostgreSQL
│   ├── services/
│   │   ├── driveService.js        # Google Drive API v3 (download em buffer e limpeza)
│   │   ├── aiService.js           # Gemini Vision AI com retry e prompt vendedor
│   │   └── whatsappService.js     # Cliente Baileys com eventos e emissão de QR Code
│   └── utils/
│       ├── logger.js              # Logs coloridos com timestamps
│       └── parser.js              # Extração de produto, modelo e preço do nome do arquivo
├── neon.ts                        # Configuração do Neon CLI
├── package.json                   # Dependências e scripts Node 22
└── .env.example                   # Modelo de variáveis de ambiente
```

---

## ⚡ Por que esta arquitetura é perfeita para o Render?

1. **Zero Puppeteer / Chromium**:
   - `whatsapp-web.js` consome entre 400MB e 800MB de RAM e frequentemente estoura o limite de 512MB do plano gratuito do Render.
   - O **Baileys** se conecta diretamente via WebSockets nativos do WhatsApp, consumindo apenas **~50MB de RAM**.
2. **Armazenamento Não Efêmero**:
   - O Render apaga os arquivos locais a cada deploy.
   - Usando o adaptador [`src/database/prismaAuthState.js`](file:///C:/Users/luiza/Documents/bot-whatsapp/src/database/prismaAuthState.js), todas as chaves criptográficas da sessão do WhatsApp são salvas e lidas em tempo real na tabela `Session` do seu banco de dados **Neon PostgreSQL**.
   - **Resultado:** você pode reiniciar, fazer deploys e atualizar a aplicação no Render sem nunca perder o login do WhatsApp!
3. **Dashboard Web com Tailwind CSS**:
   - O Render exige que a aplicação abra uma porta HTTP (`process.env.PORT`).
   - O Express atende a esse requisito na rota `/` exibindo um painel com:
     - Badge em tempo real: 🟢 **Online** / 🟡 **Aguardando QR Code** / 🔴 **Desconectado**.
     - Renderização visual do QR Code na tela quando for necessário conectar.
     - Botões para disparo imediato e simulação dry-run.
     - Rota `/healthz` para monitoramento do Render ou serviços de ping como UptimeRobot (keep-awake).

---

## 🔄 Fluxo de Automação das 5 Etapas

1. **Google Drive**: Busca fotos na pasta do Drive configurada, sorteia uma aleatória e baixa diretamente para um buffer em memória.
2. **Extração Inteligente**: Analisa o nome da foto (ex: `Real-Madrid-Home-24-25_Torcedor_149,90.jpg` ou `borussia-26-27.jpg`) extraindo time, temporada, modelo e preço.
3. **IA Vision (Gemini)**: Envia a imagem e os dados extraídos para o modelo multimodal do Gemini com o prompt:
   > *"Você é um vendedor da CHB IMPORT. Crie uma legenda curta, persuasiva e com emojis para o WhatsApp baseada nesta imagem e nos detalhes do arquivo. Destaque o preço."*
4. **Disparo no WhatsApp**: Envia a foto com a legenda gerada diretamente no grupo alvo via socket Baileys.
5. **Limpeza no Drive**: Move a foto publicada para a subpasta `"Enviadas"` para nunca repetir produtos.

---

## 🚀 Como Executar Localmente

### 1. Diagnóstico do Ambiente
```powershell
npm run check
```
Verifica o banco Neon, o Google Drive e o Gemini AI.

### 2. Teste Simulado (Dry-Run - Sem Enviar Nada)
```powershell
npm run test:dry-run
```
Baixa uma foto real do Drive, extrai o nome, gera a legenda com a IA e exibe o preview no terminal sem enviar para o grupo e sem mexer no Drive.

### 3. Iniciar o Bot Completo (com Dashboard Web e WhatsApp)
```powershell
npm start
```
Acesse no seu navegador: **`http://localhost:3000`** para ver o painel administrativo!

---

## 🌐 Como Hospedar no Render (Passo a Passo)

### Passo 1: Subir o Código para o GitHub
Crie um repositório privado no GitHub e envie este projeto:
```bash
git init
git add .
git commit -m "feat: bot whatsapp chb import com baileys e neon"
git branch -M main
git remote add origin https://github.com/SEU-USUARIO/bot-whatsapp.git
git push -u origin main
```

### Passo 2: Criar o Web Service no Render
1. Acesse o [Dashboard do Render](https://dashboard.render.com/) e clique em **New + > Web Service**.
2. Conecte sua conta do GitHub e selecione o repositório `bot-whatsapp`.
3. Preencha as configurações:
   - **Name:** `chb-whatsapp-bot`
   - **Region:** `Ohio` ou `Frankfurt` (ou mais próxima)
   - **Runtime:** `Node`
   - **Node Version:** `22`
   - **Build Command:**
     ```bash
     npm install && npx prisma db push
     ```
   - **Start Command:**
     ```bash
     npm start
     ```
   - **Instance Type:** `Free` ou `Starter`

### Passo 3: Configurar as Variáveis de Ambiente no Render
Na aba **Environment** do seu Web Service no Render, adicione as variáveis:

| Variável | Descrição / Valor |
| :--- | :--- |
| `NODE_VERSION` | `22` |
| `DATABASE_URL` | Sua URL do Neon (já gerada em seu `.env`) |
| `GEMINI_API_KEY` | Sua chave do Google Gemini AI |
| `GEMINI_MODEL` | `gemini-3.5-flash-lite` |
| `GOOGLE_DRIVE_FOLDER_ID` | `13CAQavdPhAAfQBNFxtifhUPgjkIYRtgi` |
| `WHATSAPP_GROUP_NAME` | `CHB - Futebol e Streetwear` |
| `CRON_SCHEDULE` | `0 12,14 * * *` |
| `TIMEZONE` | `America/Sao_Paulo` |
| `GOOGLE_CREDENTIALS_JSON` | **Cole o conteúdo completo do seu `credentials.json` aqui!** |

> 💡 **Super Dica:** Graças ao suporte a `GOOGLE_CREDENTIALS_JSON`, você não precisa fazer upload de arquivo nenhum no Render: basta abrir o seu `credentials.json`, copiar todo o texto e colar como valor dessa variável de ambiente!

### Passo 4: Conectar o WhatsApp
1. Após o deploy finalizar, clique na URL pública do seu serviço no Render (ex: `https://chb-whatsapp-bot.onrender.com`).
2. O dashboard abrirá com o **QR Code na tela** (e também estará nos logs do Render).
3. No WhatsApp do seu celular: **Aparelhos Conectados > Conectar um Aparelho** e aponte para o QR Code.
4. O status mudará imediatamente para 🟢 **Online e Conectado**!
5. As credenciais serão salvas no banco Neon e você nunca mais precisará escanear o QR Code nos próximos deploys.

### Passo 5: Manter o Render Ativo (Keep-Awake)
No plano gratuito do Render, o serviço suspende após 15 minutos sem receber tráfego HTTP. Para mantê-lo rodando 24 horas por dia:
1. Acesse o [UptimeRobot](https://uptimerobot.com/) ou [cron-job.org](https://cron-job.org) (gratuitos).
2. Adicione um monitor do tipo **HTTP(s)** apontando para:
   ```text
   https://seu-bot.onrender.com/healthz
   ```
3. Defina o intervalo de verificação para a cada **5 ou 10 minutos**.
4. Pronto! Seu bot ficará online 24/7 sem dormir e postará rigorosamente nos horários definidos no cron.
