import cron from 'node-cron';
import { runAutomationWorkflow } from './workflow.js';
import { config } from './config/index.js';
import { logger } from './utils/logger.js';

let cronTask = null;

/**
 * Inicia o agendador de tarefas periódicas
 */
export function startScheduler() {
  if (cronTask) return cronTask;

  logger.info(`⏰ Configurando agendador cron: "${config.cron.schedule}" (Timezone: ${config.cron.timezone})`);

  cronTask = cron.schedule(
    config.cron.schedule,
    async () => {
      logger.info('⏰ Horário agendado atingido pelo cron! Disparando publicação...');
      await runAutomationWorkflow({ dryRun: false });
    },
    {
      timezone: config.cron.timezone,
    }
  );

  cronTask.start();
  logger.info('✅ Agendador automático iniciado com sucesso!');
  return cronTask;
}

/**
 * Para o agendador de tarefas
 */
export function stopScheduler() {
  if (cronTask) {
    cronTask.stop();
    cronTask = null;
    logger.info('Agendador cron interrompido.');
  }
}
