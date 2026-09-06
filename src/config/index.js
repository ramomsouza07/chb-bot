import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';

dotenv.config();

const requiredEnv = ['GEMINI_API_KEY', 'GOOGLE_DRIVE_FOLDER_ID', 'DATABASE_URL'];

export function validateConfig() {
  const missing = requiredEnv.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    throw new Error(
      `[Config] Variáveis de ambiente obrigatórias não encontradas no .env: ${missing.join(', ')}`
    );
  }

  // Se fornecido JSON de credenciais direto na variável de ambiente (ideal para Render)
  if (process.env.GOOGLE_CREDENTIALS_JSON) {
    const credsPath = path.resolve(process.cwd(), './credentials.json');
    if (!fs.existsSync(credsPath)) {
      try {
        fs.writeFileSync(credsPath, process.env.GOOGLE_CREDENTIALS_JSON, 'utf8');
      } catch (err) {
        logger.warn('Não foi possível gravar credentials.json a partir do GOOGLE_CREDENTIALS_JSON:', err.message);
      }
    }
  }

  // Verifica se o arquivo de credenciais do Google existe
  const credsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS || './credentials.json';
  const resolvedCredsPath = path.resolve(process.cwd(), credsPath);
  if (!fs.existsSync(resolvedCredsPath)) {
    throw new Error(
      `[Config] Arquivo de credenciais da Service Account do Google não foi encontrado em: ${resolvedCredsPath}.\n` +
      `Coloque o arquivo credentials.json na raiz do projeto ou configure GOOGLE_CREDENTIALS_JSON no .env.`
    );
  }
}

export const config = {
  server: {
    port: parseInt(process.env.PORT || '3000', 10),
  },
  database: {
    url: process.env.DATABASE_URL,
  },
  gemini: {
    apiKey: process.env.GEMINI_API_KEY,
    model: process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite',
  },
  drive: {
    credentialsPath: path.resolve(
      process.cwd(),
      process.env.GOOGLE_APPLICATION_CREDENTIALS || './credentials.json'
    ),
    folderId: process.env.GOOGLE_DRIVE_FOLDER_ID,
    sentFolderId: process.env.GOOGLE_DRIVE_SENT_FOLDER_ID || null,
  },
  whatsapp: {
    groupName: process.env.WHATSAPP_GROUP_NAME || 'Ofertas CHB IMPORT',
    groupId: process.env.WHATSAPP_GROUP_ID || null,
    sessionId: process.env.WHATSAPP_SESSION_ID || 'chb-bot',
  },
  cron: {
    // Roda por padrão 5 vezes ao dia: 09:00, 12:00, 15:00, 18:00, 21:00
    schedule: process.env.CRON_SCHEDULE || '0 9,12,15,18,21 * * *',
    timezone: process.env.TIMEZONE || 'America/Sao_Paulo',
  }
};
