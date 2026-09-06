import { initAuthCreds, BufferJSON } from '@whiskeysockets/baileys';
import { prisma } from './prisma.js';
import { logger } from '../utils/logger.js';

/**
 * Adaptador de autenticação do Baileys para salvar credenciais e chaves no PostgreSQL via Prisma.
 * Garante que a sessão persista entre deploys e reinícios de containers efêmeros (como no Render).
 *
 * @param {string} sessionId Identificador da sessão (padrão: "chb-bot")
 */
export async function usePrismaAuthState(sessionId = 'chb-bot') {
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
    try {
      const row = await prisma.session.findUnique({
        where: {
          sessionId_key: { sessionId, key },
        },
      });

      if (!row || !row.value) return null;
      return JSON.parse(row.value, BufferJSON.reviver);
    } catch (err) {
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
          await Promise.all(
            ids.map(async (id) => {
              const value = await readData(`${type}-${id}`);
              if (value) {
                data[id] = value;
              }
            })
          );
          return data;
        },
        set: async (data) => {
          const tasks = [];
          for (const type of Object.keys(data)) {
            for (const id of Object.keys(data[type])) {
              const value = data[type][id];
              const key = `${type}-${id}`;
              if (value) {
                tasks.push(writeData(key, value));
              } else {
                tasks.push(removeData(key));
              }
            }
          }
          await Promise.all(tasks);
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
