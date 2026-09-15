import { validateConfig, config } from './config/index.js';
import { prisma } from './database/prisma.js';
import { driveService } from './services/driveService.js';
import { aiService } from './services/aiService.js';
import { logger } from './utils/logger.js';
import fs from 'fs';

async function checkSetup() {
  console.log('\n==================================================');
  console.log('🔍 DIAGNÓSTICO DO SISTEMA - CHB IMPORT (NEON + BAILEYS)');
  console.log('==================================================\n');

  // 1. Validação de Arquivos e Variáveis
  try {
    validateConfig();
    logger.info('✅ Arquivo .env e credentials.json encontrados e carregados.');
  } catch (err) {
    logger.error('❌ Falha na configuração inicial:\n', err.message);
    process.exit(1);
  }

  // 2. Teste do Banco de Dados Neon (Prisma)
  console.log('\n--- [1/3] Testando Banco de Dados Neon (Prisma) ---');
  try {
    await prisma.$connect();
    const count = await prisma.session.count();
    logger.info(`✅ Banco de Dados Neon conectado com sucesso! Registros de sessão salvos: ${count}`);
  } catch (err) {
    logger.error('❌ Falha ao conectar ao banco Neon via Prisma:', err.message);
  } finally {
    await prisma.$disconnect();
  }

  // 3. Teste da IA (Gemini)
  console.log('\n--- [2/3] Testando Inteligência Artificial (Gemini) ---');
  try {
    aiService.init();
    const res = await aiService.model.generateContent('Responda apenas: CONECTADO COM SUCESSO');
    const text = (await res.response).text().trim();
    logger.info(`✅ Gemini AI funcionando perfeitamente! (Modelo: ${config.gemini.model})`);
    logger.info(`   Resposta da IA: "${text}"`);
  } catch (err) {
    logger.error('❌ Falha ao comunicar com o Gemini AI:', err.message);
  }

  // 4. Teste do Google Drive
  console.log('\n--- [3/3] Testando Google Drive API ---');
  try {
    const creds = config.drive.getCredentials ? config.drive.getCredentials() : null;
    if (!creds) {
      throw new Error('Credenciais do Google Drive não encontradas em credentials.json nem em GOOGLE_CREDENTIALS_JSON.');
    }
    logger.info(`Conta de Serviço: ${creds.client_email}`);

    const file = await driveService.getRandomImage();
    if (file) {
      logger.info(`✅ Google Drive conectado com sucesso! Imagem de teste encontrada: "${file.name}"`);
    } else {
      logger.warn('⚠️ Google Drive conectado com sucesso, mas NÃO HÁ IMAGENS na pasta configurada.');
    }
  } catch (err) {
    logger.error('❌ Falha ao acessar o Google Drive:', err.message);
  }

  console.log('\n==================================================\n');
  process.exit(0);
}

checkSetup();
