import { initAuthCreds, BufferJSON } from '@whiskeysockets/baileys';
import { prisma } from './prisma.js';
import { logger } from '../utils/logger.js';

/**
 * Adaptador de autenticação do Baileys para salvar credenciais e chaves no PostgreSQL via Prisma.
 * Garante que a sessão persista entre deploys e reinícios de containers efêmeros (como no Render).
 *
 * @param {string} sessionId Identificador da sessão (padrão: "chb-bot")
 */
let tableChecked = false;
async function ensureSessionTable() {
  if (tableChecked) return;
  try {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "Session" (
        "sessionId" TEXT NOT NULL DEFAULT 'chb-bot',
        "key" TEXT NOT NULL,
        "value" TEXT NOT NULL,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "Session_pkey" PRIMARY KEY ("sessionId", "key")
      );
    `);
    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS "Session_sessionId_idx" ON "Session"("sessionId");
    `);
    tableChecked = true;
  } catch (err) {
    logger.warn('[PrismaAuthState] Aviso ao verificar tabela Session:', err.message);
  }
}

export async function usePrismaAuthState(sessionId = 'chb-bot') {
  await ensureSessionTable();

  const writeData = async (key, data) => {
    try {
      if (data === null || data === undefined) {
        await prisma.session.deleteMany({
          where: { sessionId, key },
        });
      } else {
        const value = JSON.stringify(data, BufferJSON.replacer);
        await prisma.session.upsert({
          where: {
            sessionId_key: { sessionId, key },
          },
          update: { value },
          create: { sessionId, key, value },
        });
      }
    } catch (err) {
      logger.error(`[PrismaAuthState] Erro ao gravar chave "${key}":`, err.message);
    }
  };

  const readData = async (key) => {
    let timeoutId;
    try {
      const queryPromise = prisma.session.findUnique({
        where: {
          sessionId_key: { sessionId, key },
        },
      });
      const timeoutPromise = new Promise((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error('Timeout de consulta ao banco (4s)')), 4000);
      });
      const row = await Promise.race([queryPromise, timeoutPromise]);
      if (timeoutId) clearTimeout(timeoutId);

      if (!row || !row.value) return null;
      return JSON.parse(row.value, BufferJSON.reviver);
    } catch (err) {
      if (timeoutId) clearTimeout(timeoutId);
      logger.error(`[PrismaAuthState] Erro ao ler chave "${key}":`, err.message);
      return null;
    }
  };

  const removeData = async (key) => {
    try {
      await prisma.session.deleteMany({
        where: { sessionId, key },
      });
    } catch (err) {
      logger.error(`[PrismaAuthState] Erro ao remover chave "${key}":`, err.message);
    }
  };

  // 1. Carrega ou inicializa as credenciais
  const storedCreds = await readData('creds');
  const creds = storedCreds || initAuthCreds();

  return {
    state: {
      creds,
      keys: {
        get: async (type, ids) => {
          const data = {};
          const chunkSize = 10;
          for (let i = 0; i < ids.length; i += chunkSize) {
            const chunk = ids.slice(i, i + chunkSize);
            await Promise.all(
              chunk.map(async (id) => {
                const value = await readData(`${type}-${id}`);
                if (value) {
                  data[id] = value;
                }
              })
            );
          }
          return data;
        },
        set: async (data) => {
          const tasks = [];
          for (const type of Object.keys(data)) {
            for (const id of Object.keys(data[type])) {
              const value = data[type][id];
              const key = `${type}-${id}`;
              tasks.push(() => (value ? writeData(key, value) : removeData(key)));
            }
          }
          const chunkSize = 10;
          for (let i = 0; i < tasks.length; i += chunkSize) {
            await Promise.all(tasks.slice(i, i + chunkSize).map((task) => task()));
          }
        },
      },
    },
    saveCreds: async () => {
      await writeData('creds', creds);
    },
    clearSession: async () => {
      logger.info(`[PrismaAuthState] Limpando dados da sessão "${sessionId}"...`);
      await prisma.session.deleteMany({
        where: { sessionId },
      });
    },
  };
}
