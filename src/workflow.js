import { driveService } from './services/driveService.js';
import { aiService } from './services/aiService.js';
import { whatsappService } from './services/whatsappService.js';
import { parseFilename } from './utils/parser.js';
import { logger } from './utils/logger.js';
import { config } from './config/index.js';

let isRunning = false;

// Métricas e histórico para o Dashboard
const workflowStats = {
  lastRunTime: null,
  lastProductName: null,
  lastCaption: null,
  lastError: null,
  totalPostsSent: 0,
  totalSimulations: 0,
};

export function getWorkflowStats() {
  return {
    ...workflowStats,
    isCurrentlyRunning: isRunning,
  };
}

/**
 * Executa o fluxo completo de publicação automática
 * @param {{ dryRun?: boolean }} options Se dryRun for true, não envia para o WhatsApp nem move arquivos no Drive
 */
export async function runAutomationWorkflow(options = {}) {
  const isDryRun = !!options.dryRun;

  if (isRunning) {
    logger.warn('Uma execução anterior ainda está em andamento. Ignorando este ciclo.');
    return { success: false, message: 'Execução anterior ainda em andamento.' };
  }

  isRunning = true;
  const startTime = Date.now();
  logger.info('==================================================');
  logger.info(isDryRun ? '🧪 INICIANDO TESTE SIMULADO (DRY RUN - SEM VALER NADA)...' : '🚀 Iniciando ciclo de publicação da CHB IMPORT...');
  logger.info('==================================================');

  try {
    // -----------------------------------------------------------------
    // Passo 1: Google Drive - Obter imagem aleatória e baixar em memória
    // -----------------------------------------------------------------
    logger.info('[Passo 1/5] Selecionando imagem no Google Drive...');
    const imageFile = await driveService.getRandomImage();

    if (!imageFile) {
      logger.warn('⚠️ Nenhuma imagem disponível para publicação na pasta do Drive. Ciclo finalizado.');
      return { success: false, message: 'Nenhuma imagem pendente encontrada na pasta do Drive.' };
    }

    const imageBuffer = await driveService.downloadImageBuffer(imageFile.id);

    // -----------------------------------------------------------------
    // Passo 2: Extração de Dados - Ler nome do arquivo e extrair detalhes
    // -----------------------------------------------------------------
    logger.info(`[Passo 2/5] Extraindo informações do arquivo "${imageFile.name}"...`);
    const productInfo = parseFilename(imageFile.name);
    logger.info(`Dados extraídos -> Produto: "${productInfo.title}" | Versão: "${productInfo.version}" | Preço: "${productInfo.price}"`);

    // -----------------------------------------------------------------
    // Passo 3: IA Vision - Gerar legenda persuasiva para WhatsApp
    // -----------------------------------------------------------------
    logger.info('[Passo 3/5] Gerando legenda com Inteligência Artificial...');
    const caption = await aiService.generateCaption(
      imageBuffer,
      imageFile.mimeType || 'image/jpeg',
      productInfo
    );

    // -----------------------------------------------------------------
    // Passo 4: WhatsApp - Enviar imagem com a legenda para o grupo
    // -----------------------------------------------------------------
    if (isDryRun) {
      console.log('\n==================================================');
      console.log('📱 PRÉVIA DA MENSAGEM DO WHATSAPP (SIMULAÇÃO)');
      console.log('==================================================');
      console.log(`[Imagem Anexada]: ${imageFile.name} (${(imageBuffer.length / 1024).toFixed(1)} KB)`);
      console.log(`[Grupo Destino]: "${config.whatsapp.groupName}"`);
      console.log('\n--- LEGENDA GERADA PELA IA ---');
      console.log(caption);
      console.log('------------------------------\n');
      logger.info('🛡️ [Passo 4/5 - SIMULAÇÃO] Envio para WhatsApp ignorado com sucesso (nenhum cliente recebeu nada).');
      workflowStats.totalSimulations += 1;
    } else {
      logger.info('[Passo 4/5] Enviando postagem para o WhatsApp via Baileys...');
      await whatsappService.sendImagePost(
        imageBuffer,
        imageFile.mimeType || 'image/jpeg',
        imageFile.name,
        caption
      );
      workflowStats.totalPostsSent += 1;
    }

    // -----------------------------------------------------------------
    // Passo 5: Limpeza - Mover imagem para subpasta "Enviadas" no Drive
    // -----------------------------------------------------------------
    if (isDryRun) {
      logger.info('🛡️ [Passo 5/5 - SIMULAÇÃO] Movimentação no Google Drive ignorada (o arquivo continua intacto na pasta original).');
    } else {
      logger.info('[Passo 5/5] Movendo imagem para a subpasta "Enviadas" no Drive...');
      await driveService.moveFileToSent(imageFile.id, config.drive.folderId);
    }

    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    workflowStats.lastRunTime = new Date().toISOString();
    workflowStats.lastProductName = productInfo.title;
    workflowStats.lastCaption = caption;
    workflowStats.lastError = null;

    if (isDryRun) {
      logger.info(`✅ [SIMULAÇÃO CONCLUÍDA] Teste 100% bem-sucedido em ${duration}s!`);
      logger.info('Tudo funciona: Leitura do Drive, Extração do Nome e IA Vision do Gemini.');
    } else {
      logger.info(`✅ Ciclo concluído com sucesso em ${duration}s! Produto "${productInfo.title}" publicado no grupo.`);
    }
    logger.info('==================================================\n');

    return {
      success: true,
      product: productInfo.title,
      price: productInfo.price,
      durationSeconds: duration,
      caption,
    };
  } catch (error) {
    logger.error('❌ Erro durante o ciclo:', error.message);
    workflowStats.lastError = error.message;
    return { success: false, error: error.message };
  } finally {
    isRunning = false;
  }
}
