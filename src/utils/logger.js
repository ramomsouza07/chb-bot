/**
 * Utilitário simples de logs com timestamp formatado.
 */
const formatTime = () => new Date().toLocaleString('pt-BR', { timeZone: process.env.TIMEZONE || 'America/Sao_Paulo' });

export const logger = {
  info: (msg, ...args) => console.log(`\x1b[32m[INFO - ${formatTime()}]\x1b[0m ${msg}`, ...args),
  warn: (msg, ...args) => console.warn(`\x1b[33m[WARN - ${formatTime()}]\x1b[0m ${msg}`, ...args),
  error: (msg, ...args) => console.error(`\x1b[31m[ERROR - ${formatTime()}]\x1b[0m ${msg}`, ...args),
  debug: (msg, ...args) => {
    if (process.env.DEBUG === 'true') {
      console.log(`\x1b[36m[DEBUG - ${formatTime()}]\x1b[0m ${msg}`, ...args);
    }
  }
};
