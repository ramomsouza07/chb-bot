import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';

dotenv.config();

const requiredEnv = ['GEMINI_API_KEY', 'GOOGLE_DRIVE_FOLDER_ID', 'DATABASE_URL'];

export function getGoogleCredentials() {
  // 1. Variável GOOGLE_CREDENTIALS_JSON (direto em JSON ou base64)
  let rawJson = process.env.GOOGLE_CREDENTIALS_JSON;

  // 2. Se GOOGLE_APPLICATION_CREDENTIALS for o próprio conteúdo JSON
  if (!rawJson && process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    const val = process.env.GOOGLE_APPLICATION_CREDENTIALS.trim();
    if (val.startsWith('{') && val.endsWith('}')) {
      rawJson = val;
    }
  }

  if (rawJson) {
    let str = rawJson.trim();
    if (!str.startsWith('{')) {
      try {
        str = Buffer.from(str, 'base64').toString('utf8');
      } catch (e) {}
    }
    try {
      const parsed = JSON.parse(str);
      if (parsed.private_key) {
        parsed.private_key = parsed.private_key.replace(/\\n/g, '\n');
      }
      return parsed;
    } catch (err) {
      console.warn('[Config] Erro ao interpretar GOOGLE_CREDENTIALS_JSON:', err.message);
    }
  }

  // 3. Chaves individuais
  if (process.env.GOOGLE_CLIENT_EMAIL && process.env.GOOGLE_PRIVATE_KEY) {
    return {
      client_email: process.env.GOOGLE_CLIENT_EMAIL,
      private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    };
  }

  // 4. Arquivo no disco (se existir)
  const candidatePaths = [
    process.env.GOOGLE_APPLICATION_CREDENTIALS,
    path.resolve(process.cwd(), './credentials.json'),
    '/tmp/credentials.json',
  ].filter(Boolean);

  for (const p of candidatePaths) {
    try {
      if (fs.existsSync(p)) {
        const content = fs.readFileSync(p, 'utf8');
        const parsed = JSON.parse(content);
        if (parsed.private_key) {
          parsed.private_key = parsed.private_key.replace(/\\n/g, '\n');
        }
        return parsed;
      }
    } catch (e) {}
  }

  return null;
}

export function validateConfig() {
  const missing = requiredEnv.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    throw new Error(
      `[Config] Variáveis de ambiente obrigatórias não encontradas no .env: ${missing.join(', ')}`
    );
  }

  const creds = getGoogleCredentials();
  if (!creds) {
    throw new Error(
      `[Config] Credenciais do Google Drive não configuradas.\n` +
      `Configure a variável GOOGLE_CREDENTIALS_JSON no seu painel de deploy (Vercel ou Render) com o conteúdo do arquivo credentials.json.`
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
    getCredentials: getGoogleCredentials,
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
    // Roda 2 vezes ao dia: 12:00 e 14:00
    schedule: process.env.CRON_SCHEDULE || '0 12,14 * * *',
    timezone: process.env.TIMEZONE || 'America/Sao_Paulo',
  }
};
