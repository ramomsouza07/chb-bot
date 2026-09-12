import { validateConfig, config } from './config/index.js';
import { prisma } from './database/prisma.js';
import { whatsappService } from './services/whatsappService.js';
import { runAutomationWorkflow } from './workflow.js';
import { createServer } from './server.js';
import { startScheduler, stopScheduler } from './scheduler.js';
import { logger } from './utils/logger.js';

async function main() {
  logger.info('==================================================');
  logger.info('🔥 INICIANDO CHB IMPORT BOT (BAILEYS + NEON + RENDER) 🔥');
  logger.info('==================================================');

  // 1. Modo de simulação local rápida via CLI (--dry-run)
  if (process.argv.includes('--dry-run')) {
    logger.info('🧪 Flag --dry-run detectada! Executando simulação sem inicializar o WhatsApp Web ou o servidor...');
    try {
      validateConfig();
      await runAutomationWorkflow({ dryRun: true });
    } catch (err) {
      logger.error('Erro na simulação dry-run:', err.message);
    }
    return;
  }

  // 2. Inicializa o Servidor Express (Essencial para o Dashboard Web, Render e Keep-Awake)
  const app = createServer();
  const server = app.listen(config.server.port, () => {
    logger.info(`🌐 Servidor Express ativo na porta ${config.server.port}`);
    logger.info(`👉 Acesse o Dashboard em: http://localhost:${config.server.port}`);
  });

  // 3. Validação de variáveis de ambiente e arquivos
  let isConfigured = false;
  try {
    validateConfig();
    isConfigured = true;
  } catch (err) {
    logger.warn(`⚠️ Configurações pendentes:\n   ${err.message}`);
    logger.info('👉 O painel web está acessível para testes visuais. Para ativar o robô completo, configure o .env e credentials.json.');
  }

  // 4. Se configurado, conecta banco Neon, WhatsApp Baileys e Agendador Cron
  if (isConfigured) {
    try {
      logger.info('Testando conexão com o banco de dados Neon PostgreSQL...');
      await prisma.$connect();
      logger.info('✅ Banco de Dados Neon conectado com sucesso!');

      // Inicializa o WhatsApp Baileys com persistência no Neon
      whatsappService.initialize().catch((err) => {
        logger.error('Erro na conexão contínua do WhatsApp:', err.message);
      });

      // Inicia o agendador de tarefas periódicas (12h e 14h)
      startScheduler();

      // Se solicitado disparo imediato via CLI (--run-now)
      if (process.argv.includes('--run-now')) {
        logger.info('Flag --run-now detectada! Aguardando o bot ficar online para disparar...');
        whatsappService.waitUntilOnline().then(async () => {
          await runAutomationWorkflow({ dryRun: false });
        });
      }
    } catch (err) {
      logger.error('❌ Falha ao conectar ao banco de dados Neon:', err.message);
    }
  }

  // 8. Graceful Shutdown (Encerramento limpo)
  const shutdown = async (signal) => {
    logger.info(`Sinal [${signal}] recebido. Desligando servidor e desconectando serviços...`);
    stopScheduler();
    server.close();
    if (isConfigured) {
      await prisma.$disconnect().catch(() => {});
    }
    logger.info('Aplicação finalizada com segurança.');
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
  logger.error('Erro fatal:', err);
  process.exit(1);
});
