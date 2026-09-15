import express from 'express';
import { whatsappService } from './services/whatsappService.js';
import { runAutomationWorkflow, getWorkflowStats } from './workflow.js';
import { config } from './config/index.js';
import { logger } from './utils/logger.js';

export function createServer() {
  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // Health check para o Render / UptimeRobot
  app.get('/healthz', (req, res) => {
    res.status(200).json({
      status: 'ok',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
      botStatus: whatsappService.getStatus().status,
    });
  });

  // API de status em tempo real (consumida pelo frontend para polling sem recarregar)
  app.get('/api/status', async (req, res) => {
    // Tenta inicialização automática se estiver desconectado ou em erro
    if ((whatsappService.status === 'disconnected' || whatsappService.status === 'error') && !whatsappService._isInitializing) {
      if (process.env.DATABASE_URL) {
        whatsappService.initialize().catch((err) => {
          logger.error('Erro no auto-start do WhatsApp via /api/status:', err.message);
        });
      } else {
        whatsappService.lastError = 'A variável DATABASE_URL (Neon PostgreSQL) não foi configurada no deploy.';
      }
    }

    // Se ainda não temos QR Code nem estamos online, aguarda brevemente (até 3.5s) para o Baileys emitir o QR Code
    if (whatsappService.status !== 'online' && !whatsappService.qrDataUrl && process.env.DATABASE_URL) {
      await whatsappService.waitForQrOrOnline(3500);
    } else if (whatsappService.status === 'waiting_qr' && Boolean(process.env.VERCEL)) {
      // No Vercel Serverless, mantém a requisição ativa por até 2.5s para permitir que o handshake do escaneamento do QR Code seja concluído
      await whatsappService.waitForOnline(2500);
    }

    const wa = whatsappService.getStatus();
    const stats = getWorkflowStats();

    res.json({
      ...wa,
      ...stats,
      hasDatabaseUrl: Boolean(process.env.DATABASE_URL),
      hasGeminiKey: Boolean(process.env.GEMINI_API_KEY),
      hasDriveFolder: Boolean(process.env.GOOGLE_DRIVE_FOLDER_ID),
      hasGoogleCreds: Boolean(config.drive.getCredentials ? config.drive.getCredentials() : false),
      cronSchedule: config.cron.schedule,
      timezone: config.cron.timezone,
    });
  });

  // Conexão e emissão de QR Code (suporta GET e POST para compatibilidade total)
  app.all(['/api/connect', '/api/connect-wa'], async (req, res) => {
    logger.info('[API] Solicitação de conexão com WhatsApp recebida.');
    try {
      if (!process.env.DATABASE_URL) {
        return res.status(400).json({
          success: false,
          error: 'A variável de ambiente DATABASE_URL não está configurada no Vercel. O Baileys precisa da URL do PostgreSQL (Neon) para salvar a sessão.',
        });
      }

      if (whatsappService.status !== 'online' && !whatsappService._isInitializing) {
        whatsappService.initialize().catch((err) => {
          logger.error('Erro ao conectar WhatsApp:', err.message);
        });
      }

      // Aguarda no máximo 3 segundos para responder com rapidez sem exceder o tempo limite do Vercel
      const result = await whatsappService.waitForQrOrOnline(3000);
      res.json({
        success: result.status !== 'error',
        ...result,
      });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // Disparo manual imediato
  app.post('/api/trigger', async (req, res) => {
    logger.info('[Dashboard Web] Disparo manual solicitado via painel.');
    const result = await runAutomationWorkflow({ dryRun: false });
    res.json(result);
  });

  // Disparo de teste simulado (Dry-Run)
  app.post('/api/trigger-dry-run', async (req, res) => {
    logger.info('[Dashboard Web] Simulação dry-run solicitada via painel.');
    const result = await runAutomationWorkflow({ dryRun: true });
    res.json(result);
  });

  // Dashboard principal com Tailwind CSS via CDN
  app.get('/', async (req, res) => {
    // Tenta inicialização automática se estiver desconectado ou em erro
    if ((whatsappService.status === 'disconnected' || whatsappService.status === 'error') && !whatsappService._isInitializing) {
      if (process.env.DATABASE_URL) {
        whatsappService.initialize().catch((err) => {
          logger.error('Erro no auto-start do WhatsApp via GET /:', err.message);
        });
      } else {
        whatsappService.lastError = 'A variável DATABASE_URL (Neon PostgreSQL) não foi configurada no deploy.';
      }
    }

    // Se ainda não tiver QR Code nem estiver online, aguarda brevemente (até 2.5s) para tentar enviar o QR já pronto no HTML
    if (whatsappService.status !== 'online' && !whatsappService.qrDataUrl && process.env.DATABASE_URL) {
      await whatsappService.waitForQrOrOnline(2500);
    }

    const wa = whatsappService.getStatus();
    const stats = getWorkflowStats();

    const statusColors = {
      online: 'bg-emerald-500 text-white',
      waiting_qr: 'bg-amber-500 text-white',
      connecting: 'bg-blue-500 text-white',
      disconnected: 'bg-rose-500 text-white',
      error: 'bg-red-700 text-white',
    };

    const statusLabels = {
      online: 'Online e Conectado',
      waiting_qr: 'Aguardando Leitura do QR Code',
      connecting: 'Conectando ao WhatsApp...',
      disconnected: 'Desconectado',
      error: 'Erro de Conexão',
    };

    const currentBadgeClass = statusColors[wa.status] || 'bg-gray-500 text-white';
    const currentStatusLabel = statusLabels[wa.status] || 'Desconhecido';

    const html = `
<!DOCTYPE html>
<html lang="pt-BR" class="h-full bg-slate-950">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>CHB IMPORT | Bot WhatsApp Admin</title>
  <!-- Tailwind CSS CDN -->
  <script src="https://cdn.tailwindcss.com"></script>
  <script>
    tailwind.config = {
      theme: {
        extend: {
          colors: {
            brand: {
              50: '#f0fdf4',
              500: '#22c55e',
              600: '#16a34a',
              700: '#15803d',
            }
          }
        }
      }
    }
  </script>
</head>
<body class="min-h-full flex flex-col text-slate-100 font-sans antialiased">
  <!-- Top Navigation -->
  <header class="border-b border-slate-800 bg-slate-900/60 backdrop-blur sticky top-0 z-50">
    <div class="max-w-6xl mx-auto px-4 py-4 flex items-center justify-between">
      <div class="flex items-center gap-3">
        <div class="w-10 h-10 rounded-xl bg-gradient-to-tr from-brand-600 to-emerald-400 flex items-center justify-center text-xl font-black shadow-lg shadow-brand-500/20">
          ⚽
        </div>
        <div>
          <h1 class="text-xl font-bold tracking-tight text-white flex items-center gap-2">
            CHB IMPORT <span class="text-xs px-2 py-0.5 rounded-full bg-slate-800 text-brand-400 border border-slate-700">Bot WhatsApp</span>
          </h1>
          <p class="text-xs text-slate-400">Automação de Camisas Esportivas (Baileys + Neon + Gemini)</p>
        </div>
      </div>
      <div class="flex items-center gap-3">
        <span id="badge-status" class="px-3 py-1 rounded-full text-xs font-semibold uppercase tracking-wider flex items-center gap-2 shadow-sm ${currentBadgeClass}">
          <span class="w-2 h-2 rounded-full bg-white animate-pulse"></span>
          ${currentStatusLabel}
        </span>
      </div>
    </div>
  </header>

  <!-- Main Content -->
  <main class="flex-1 max-w-6xl w-full mx-auto px-4 py-8 space-y-6">
    
    <!-- Alerta de QR Code (exibido automaticamente se não estiver conectado) -->
    <div id="qr-section" class="${wa.status === 'online' ? 'hidden' : 'block'} bg-slate-900 border-2 border-amber-500/50 rounded-2xl p-6 shadow-xl text-center space-y-4">
      <div class="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-amber-500/10 text-amber-400 text-sm font-medium border border-amber-500/20">
        ⚡ Autenticação Necessária
      </div>
      <h2 class="text-2xl font-bold text-white">Escaneie o QR Code abaixo com seu WhatsApp</h2>
      <p class="text-sm text-slate-400 max-w-md mx-auto">
        No seu celular, acesse <strong>WhatsApp &gt; Aparelhos Conectados &gt; Conectar um aparelho</strong> e aponte a câmera para a imagem abaixo:
      </p>
      <div class="flex justify-center py-2">
        <div class="p-4 bg-white rounded-2xl shadow-2xl inline-flex items-center justify-center min-w-[280px] min-h-[280px]">
          <img id="qr-img" src="${wa.qrDataUrl || ''}" alt="QR Code WhatsApp" class="${wa.qrDataUrl ? 'block' : 'hidden'} w-64 h-64 mx-auto rounded-lg" />
          <div id="qr-loading" class="${wa.qrDataUrl ? 'hidden' : 'flex'} flex-col items-center justify-center p-8 text-slate-700">
            <svg class="animate-spin h-10 w-10 text-amber-500 mb-3" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
              <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
            <span class="text-xs font-semibold text-slate-600">Conectando ao WhatsApp...</span>
            <span class="text-[11px] text-slate-400 mt-1">O QR Code aparecerá aqui em instantes</span>
          </div>
        </div>
      </div>
      <p id="qr-status-msg" class="text-xs text-slate-500">
        ${wa.lastError ? '<span class="text-rose-400 font-medium">Aviso: ' + wa.lastError + '</span>' : 'A sessão será salva automaticamente no banco Neon.tech. Você só precisará conectar uma vez!'}
      </p>
    </div>

    <!-- Grid de Métricas Principais -->
    <div class="grid grid-cols-1 md:grid-cols-3 gap-5">
      <!-- Card 1: Grupo Alvo -->
      <div class="bg-slate-900/80 border border-slate-800 rounded-2xl p-5 relative overflow-hidden">
        <div class="flex items-center justify-between">
          <span class="text-xs uppercase tracking-wider font-semibold text-slate-400">Grupo de Destino</span>
          <span class="text-lg">📢</span>
        </div>
        <p class="text-xl font-bold text-white mt-2 truncate">${config.whatsapp.groupName}</p>
        <p class="text-xs text-emerald-400 mt-1 flex items-center gap-1">
          ✓ Disparos automáticos ativos
        </p>
      </div>

      <!-- Card 2: Agendamento -->
      <div class="bg-slate-900/80 border border-slate-800 rounded-2xl p-5 relative overflow-hidden">
        <div class="flex items-center justify-between">
          <span class="text-xs uppercase tracking-wider font-semibold text-slate-400">Frequência Cron</span>
          <span class="text-lg">⏰</span>
        </div>
        <p class="text-xl font-bold text-white mt-2 font-mono">${config.cron.schedule}</p>
        <p class="text-xs text-slate-400 mt-1">2x ao dia (12h e 14h)</p>
      </div>

      <!-- Card 3: Banco de Dados -->
      <div class="bg-slate-900/80 border border-slate-800 rounded-2xl p-5 relative overflow-hidden">
        <div class="flex items-center justify-between">
          <span class="text-xs uppercase tracking-wider font-semibold text-slate-400">Banco de Dados</span>
          <span class="text-lg">🗄️</span>
        </div>
        <p class="text-xl font-bold text-white mt-2">Neon PostgreSQL</p>
        <p class="text-xs text-brand-400 mt-1">✓ Sessão Baileys persistida</p>
      </div>
    </div>

    <!-- Painel de Ações e Testes -->
    <div class="bg-slate-900/80 border border-slate-800 rounded-2xl p-6 space-y-4">
      <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800/80 pb-4">
        <div>
          <h3 class="text-lg font-bold text-white">Controles Manuais de Postagem</h3>
          <p class="text-xs text-slate-400">Dispare uma publicação agora mesmo ou teste a IA sem enviar para o grupo.</p>
        </div>
        <div class="flex items-center gap-3">
          <button id="btn-dry-run" onclick="triggerPost(true)" class="px-4 py-2.5 rounded-xl text-sm font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 transition border border-slate-700 flex items-center gap-2">
            🧪 Teste Simulado (Sem Enviar)
          </button>
          <button id="btn-live-run" onclick="triggerPost(false)" class="px-5 py-2.5 rounded-xl text-sm font-semibold bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg shadow-emerald-600/30 transition flex items-center gap-2">
            🚀 Disparar para o Grupo
          </button>
        </div>
      </div>

      <!-- Área de Feedback de Execução -->
      <div id="action-feedback" class="hidden rounded-xl p-4 text-sm"></div>

      <!-- Histórico da Última Postagem -->
      <div class="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
        <div class="bg-slate-950/60 p-4 rounded-xl border border-slate-800/60">
          <span class="text-xs uppercase font-semibold text-slate-400">Último Produto Processado</span>
          <p id="stat-last-product" class="text-base font-bold text-slate-200 mt-1">
            ${stats.lastProductName || 'Nenhuma postagem recente'}
          </p>
          <p id="stat-last-time" class="text-xs text-slate-500 mt-1">
            ${stats.lastRunTime ? new Date(stats.lastRunTime).toLocaleString('pt-BR') : 'Aguardando primeiro disparo'}
          </p>
        </div>
        <div class="bg-slate-950/60 p-4 rounded-xl border border-slate-800/60">
          <span class="text-xs uppercase font-semibold text-slate-400">Total de Postagens Realizadas</span>
          <p id="stat-total-posts" class="text-2xl font-black text-brand-400 mt-1">
            ${stats.totalPostsSent}
          </p>
          <p class="text-xs text-slate-500 mt-1">Fotos movidas para subpasta "Enviadas" no Google Drive</p>
        </div>
      </div>

      <!-- Prévia da Última Legenda Gerada -->
      ${stats.lastCaption ? `
      <div class="bg-slate-950/60 p-4 rounded-xl border border-slate-800/60">
        <span class="text-xs uppercase font-semibold text-slate-400">Última Legenda Gerada pela IA</span>
        <pre class="mt-2 text-xs text-slate-300 whitespace-pre-wrap font-sans bg-slate-900/60 p-3 rounded-lg border border-slate-800/40">${stats.lastCaption}</pre>
      </div>` : ''}
    </div>

  </main>

  <footer class="border-t border-slate-800/80 py-4 text-center text-xs text-slate-500">
    CHB IMPORT &copy; 2026 &bull; Hospedado no Render &bull; Banco de Dados Neon.tech
  </footer>

  <!-- Script de Atualização em Tempo Real (Polling) -->
  <script>
    async function updateStatus() {
      try {
        const res = await fetch('/api/status');
        if (!res.ok) return;
        const contentType = res.headers.get('content-type') || '';
        if (!contentType.includes('application/json')) return;
        const data = await res.json();

        // Elementos da UI
        const badge = document.getElementById('badge-status');
        const qrSection = document.getElementById('qr-section');
        const qrImg = document.getElementById('qr-img');
        const qrLoading = document.getElementById('qr-loading');
        const qrStatusMsg = document.getElementById('qr-status-msg');

        if (data.status === 'online') {
          badge.className = 'px-3 py-1 rounded-full text-xs font-semibold uppercase tracking-wider flex items-center gap-2 shadow-sm bg-emerald-500 text-white';
          badge.innerHTML = '<span class="w-2 h-2 rounded-full bg-white animate-pulse"></span> Online e Conectado';
          if (qrSection) qrSection.classList.add('hidden');
        } else {
          if (qrSection) qrSection.classList.remove('hidden');

          if (data.qrDataUrl) {
            badge.className = 'px-3 py-1 rounded-full text-xs font-semibold uppercase tracking-wider flex items-center gap-2 shadow-sm bg-amber-500 text-white';
            badge.innerHTML = '<span class="w-2 h-2 rounded-full bg-white animate-pulse"></span> Aguardando Leitura do QR Code';
          } else if (data.status === 'connecting') {
            badge.className = 'px-3 py-1 rounded-full text-xs font-semibold uppercase tracking-wider flex items-center gap-2 shadow-sm bg-blue-500 text-white';
            badge.innerHTML = '<span class="w-2 h-2 rounded-full bg-white animate-pulse"></span> Conectando ao WhatsApp...';
          } else {
            badge.className = 'px-3 py-1 rounded-full text-xs font-semibold uppercase tracking-wider flex items-center gap-2 shadow-sm bg-rose-500 text-white';
            badge.innerHTML = '<span class="w-2 h-2 rounded-full bg-white"></span> ' + (data.status || 'Desconectado');
          }

          if (data.qrDataUrl) {
            if (qrImg) {
              qrImg.src = data.qrDataUrl;
              qrImg.classList.remove('hidden');
              qrImg.classList.add('block');
            }
            if (qrLoading) {
              qrLoading.classList.add('hidden');
              qrLoading.classList.remove('flex');
            }
          } else {
            if (qrImg) {
              qrImg.classList.add('hidden');
              qrImg.classList.remove('block');
            }
            if (qrLoading) {
              qrLoading.classList.remove('hidden');
              qrLoading.classList.add('flex');
            }
          }

          if (qrStatusMsg) {
            if (!data.hasDatabaseUrl) {
              qrStatusMsg.innerHTML = '<span class="text-amber-400 font-semibold">⚠️ Configuração:</span> A variável <code>DATABASE_URL</code> (PostgreSQL Neon) não foi detectada. Configure-a no painel do deploy para salvar a sessão.';
            } else if (data.lastError) {
              qrStatusMsg.innerHTML = '<span class="text-rose-400 font-semibold">Aviso:</span> ' + data.lastError;
            } else {
              qrStatusMsg.textContent = 'A sessão será salva automaticamente no banco Neon.tech. Você só precisará conectar uma vez!';
            }
          }
        }

        if (data.lastProductName) {
          document.getElementById('stat-last-product').textContent = data.lastProductName;
        }
        if (data.totalPostsSent !== undefined) {
          document.getElementById('stat-total-posts').textContent = data.totalPostsSent;
        }
      } catch (err) {
        console.error('Erro ao buscar status:', err);
      }
    }

    async function triggerPost(isDryRun) {
      const btn = isDryRun ? document.getElementById('btn-dry-run') : document.getElementById('btn-live-run');
      const feedback = document.getElementById('action-feedback');
      const originalText = btn.innerHTML;

      btn.disabled = true;
      btn.innerHTML = '⏳ Processando...';
      feedback.className = 'rounded-xl p-4 text-sm bg-blue-500/10 text-blue-300 border border-blue-500/20';
      feedback.textContent = isDryRun ? 'Executando simulação de postagem...' : 'Conectando ao Drive, IA e disparando no WhatsApp...';
      feedback.classList.remove('hidden');

      try {
        const endpoint = isDryRun ? '/api/trigger-dry-run' : '/api/trigger';
        const res = await fetch(endpoint, { method: 'POST' });
        const data = await res.json();

        if (data.success) {
          feedback.className = 'rounded-xl p-4 text-sm bg-emerald-500/10 text-emerald-300 border border-emerald-500/20';
          feedback.innerHTML = '✅ <strong>Sucesso!</strong> ' + (isDryRun ? 'Simulação concluída com ' : 'Postagem enviada: ') + '<strong>' + data.product + '</strong> (' + data.price + ')';
        } else {
          feedback.className = 'rounded-xl p-4 text-sm bg-rose-500/10 text-rose-300 border border-rose-500/20';
          feedback.innerHTML = '❌ <strong>Aviso:</strong> ' + (data.message || data.error || 'Erro na execução');
        }
        updateStatus();
      } catch (err) {
        feedback.className = 'rounded-xl p-4 text-sm bg-rose-500/10 text-rose-300 border border-rose-500/20';
        feedback.textContent = 'Erro ao se comunicar com o servidor: ' + err.message;
      } finally {
        btn.disabled = false;
        btn.innerHTML = originalText;
      }
    }

    // Polling sequencial protegido contra acúmulo de requisições pendentes
    let isPollingActive = false;
    async function pollLoop() {
      if (!isPollingActive) {
        isPollingActive = true;
        try {
          await updateStatus();
        } catch (err) {
          // ignora erro pontual de rede no polling
        } finally {
          isPollingActive = false;
        }
      }
      setTimeout(pollLoop, 3000);
    }
    pollLoop();
  </script>
</body>
</html>
    `;

    res.send(html);
  });

  return app;
}

// Instância principal do Express
export const app = createServer();

// Porta do servidor (Vercel injeta process.env.PORT automaticamente)
const PORT = process.env.PORT || config.server?.port || 3000;
const isVercel = Boolean(process.env.VERCEL);
const shouldListen = !isVercel && !process.argv.includes('--dry-run') && process.env.NODE_ENV !== 'test';

// Inicializa o listener HTTP (necessário para detecção do Vercel e execução direta)
export const server = shouldListen
  ? app.listen(PORT, () => {
      logger.info(`🌐 Servidor Express ativo na porta ${PORT}`);
      logger.info(`👉 Acesse o Dashboard em: http://localhost:${PORT}`);
    })
  : null;

// Auto-iniciar conexão com o WhatsApp se DATABASE_URL estiver configurado
if (process.env.DATABASE_URL && !process.argv.includes('--dry-run') && process.env.NODE_ENV !== 'test') {
  logger.info('[Server] DATABASE_URL detectada. Inicializando Baileys WhatsApp...');
  whatsappService.initialize().catch((err) => {
    logger.error('[Server] Erro ao auto-inicializar WhatsApp:', err.message);
  });
}

export default app;
