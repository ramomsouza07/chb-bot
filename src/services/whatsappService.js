import makeWASocket, {
  DisconnectReason,
  fetchLatestBaileysVersion,
  Browsers,
} from '@whiskeysockets/baileys';
import pino from 'pino';
import qrcodeTerminal from 'qrcode-terminal';
import QRCode from 'qrcode';
import { Boom } from '@hapi/boom';
import { usePrismaAuthState } from '../database/prismaAuthState.js';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';

class WhatsAppService {
  constructor() {
    this.sock = null;
    this.status = 'disconnected'; // 'disconnected' | 'waiting_qr' | 'connecting' | 'online' | 'error'
    this.qrRaw = null;
    this.qrDataUrl = null;
    this.lastConnected = null;
    this.botNumber = null;
    this.cachedTargetJid = null;
    this.clearSession = null;
    this._onlinePromise = null;
    this._resolveOnline = null;
    this._isInitializing = false;
    this.lastError = null;
  }

  /**
   * Inicializa o socket do Baileys com persistência de sessão no PostgreSQL/Neon via Prisma
   */
  async initialize() {
    if (this._isInitializing) return this._onlinePromise;
    this._isInitializing = true;
    this.lastError = null;

    this._onlinePromise = new Promise((resolve) => {
      this._resolveOnline = resolve;
    });

    try {
      logger.info('Carregando estado de autenticação do Prisma...');
      const { state, saveCreds, clearSession } = await usePrismaAuthState(config.whatsapp.sessionId);
      this.clearSession = clearSession;

      let version;
      let versionTimeoutId;
      try {
        const vPromise = fetchLatestBaileysVersion();
        const timeout = new Promise((_, reject) => {
          versionTimeoutId = setTimeout(() => reject(new Error('Version timeout')), 2500);
        });
        const res = await Promise.race([vPromise, timeout]);
        if (versionTimeoutId) clearTimeout(versionTimeoutId);
        version = res.version;
      } catch (e) {
        if (versionTimeoutId) clearTimeout(versionTimeoutId);
        logger.warn('Não foi possível obter versão do Baileys via rede rápida, usando versão padrão estável.');
        version = [2, 3000, 1015901307];
      }

      logger.info(`Conectando ao WhatsApp via Baileys (versão WA: ${version.join('.')})...`);

      this.sock = makeWASocket({
        version,
        auth: state,
        logger: pino({ level: 'silent' }),
        printQRInTerminal: false,
        browser: Browsers.ubuntu('Chrome'),
        connectTimeoutMs: 25000,
        keepAliveIntervalMs: 25000,
      });

      // Atualizações de credenciais (chaves criptográficas)
      this.sock.ev.on('creds.update', async () => {
        await saveCreds();
      });

      // Atualizações do ciclo de conexão
      this.sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
          this.status = 'waiting_qr';
          this.qrRaw = qr;
          try {
            this.qrDataUrl = await QRCode.toDataURL(qr);
          } catch (err) {
            logger.error('Erro ao gerar DataURL do QR Code:', err.message);
          }

          logger.info('\n==================================================');
          logger.info('📱 QR CODE RECEBIDO! Escaneie pelo WhatsApp do celular:');
          logger.info('==================================================');
          qrcodeTerminal.generate(qr, { small: true });
          logger.info('👉 O QR Code também está visível no painel web da aplicação.\n');
        }

        if (connection === 'connecting') {
          if (this.status !== 'waiting_qr' && !this.qrDataUrl) {
            this.status = 'connecting';
          }
          logger.info('Estabelecendo conexão com o WhatsApp...');
        }

        if (connection === 'open') {
          this.status = 'online';
          this.qrRaw = null;
          this.qrDataUrl = null;
          this.lastConnected = new Date();
          this.lastError = null;
          this.botNumber = this.sock.user?.id ? this.sock.user.id.split(':')[0] : 'Conectado';

          logger.info(`✅ 🤖 Baileys WhatsApp CONECTADO COM SUCESSO! (Número: ${this.botNumber})`);
          if (this._resolveOnline) {
            this._resolveOnline(this.sock);
          }
        }

        if (connection === 'close') {
          this.status = 'disconnected';
          this.qrRaw = null;
          this.qrDataUrl = null;
          const error = lastDisconnect?.error;
          const statusCode = error instanceof Boom ? error.output?.statusCode : null;
          const reason = DisconnectReason[statusCode] || 'Desconhecido';

          logger.warn(`Conexão do WhatsApp fechada. Código: ${statusCode} (${reason}).`);

          const isLoggedOut = statusCode === DisconnectReason.loggedOut;
          const isBadSession = statusCode === DisconnectReason.badSession;
          const isMismatch = statusCode === DisconnectReason.multideviceMismatch;
          if (isLoggedOut || isBadSession || isMismatch) {
            logger.warn('Sessão desconectada ou inválida. Limpando chaves no banco de dados...');
            if (this.clearSession) {
              await this.clearSession().catch((e) => logger.error('Erro ao limpar sessão:', e.message));
            }
          }

          try {
            this.sock?.ev?.removeAllListeners();
          } catch (e) {}

          // Reconecta automaticamente após breve intervalo
          logger.info('Tentando restabelecer conexão em 4 segundos...');
          setTimeout(() => {
            this._isInitializing = false;
            this.initialize().catch((err) => {
              logger.error('Erro na reconexão automática:', err.message);
            });
          }, 4000);
        }
      });

      return this._onlinePromise;
    } catch (err) {
      this.status = 'error';
      this.lastError = err.message;
      this._isInitializing = false;
      logger.error('Erro crítico ao inicializar Baileys:', err.message);
      setTimeout(() => {
        if (this.status === 'error') {
          this.status = 'disconnected';
        }
      }, 5000);
      throw err;
    }
  }

  /**
   * Aguarda ativamente até obter o QR Code gerado ou estabelecer conexão online
   * Essencial em ambientes serverless como Vercel para evitar que o processo congele antes do QR chegar
   * @param {number} timeoutMs Tempo máximo de espera em milissegundos
   */
  async waitForQrOrOnline(timeoutMs = 3500) {
    if (this.status === 'online') {
      return { status: 'online' };
    }
    if (this.qrDataUrl) {
      return { status: 'waiting_qr', qrDataUrl: this.qrDataUrl };
    }

    return new Promise((resolve) => {
      let timer = null;
      let interval = null;

      const finish = (result) => {
        if (timer) clearTimeout(timer);
        if (interval) clearInterval(interval);
        resolve(result);
      };

      const check = () => {
        if (this.status === 'online') {
          return finish({ status: 'online' });
        }
        if (this.qrDataUrl) {
          return finish({ status: 'waiting_qr', qrDataUrl: this.qrDataUrl });
        }
        if (this.status === 'error') {
          return finish({ status: 'error', error: this.lastError });
        }
      };

      interval = setInterval(check, 150);
      timer = setTimeout(() => {
        finish({
          status: this.status,
          qrDataUrl: this.qrDataUrl,
          message: this.status === 'connecting' ? 'Conexão em andamento com WhatsApp... Aguarde o QR Code.' : null,
          error: this.lastError,
        });
      }, timeoutMs);

      check();
    });
  }

  /**
   * Aguarda ativamente até a conexão ficar online (ou expirar o timeout)
   * Útil para manter o processo ativo enquanto o usuário escaneia o QR Code
   * @param {number} timeoutMs
   */
  async waitForOnline(timeoutMs = 2500) {
    if (this.status === 'online') return true;

    return new Promise((resolve) => {
      let timer = null;
      let interval = null;

      const finish = (val) => {
        if (timer) clearTimeout(timer);
        if (interval) clearInterval(interval);
        resolve(val);
      };

      const check = () => {
        if (this.status === 'online') finish(true);
      };

      interval = setInterval(check, 150);
      timer = setTimeout(() => finish(this.status === 'online'), timeoutMs);
      check();
    });
  }

  /**
   * Aguarda a conexão ficar no estado 'online'
   */
  async waitUntilOnline() {
    if (this.status === 'online') return this.sock;
    return this._onlinePromise;
  }

  /**
   * Localiza o JID do grupo alvo
   */
  async getTargetGroupJid() {
    if (this.cachedTargetJid) return this.cachedTargetJid;

    // 1. Se configurado JID direto no .env
    if (config.whatsapp.groupId) {
      this.cachedTargetJid = config.whatsapp.groupId.includes('@g.us')
        ? config.whatsapp.groupId
        : `${config.whatsapp.groupId}@g.us`;
      return this.cachedTargetJid;
    }

    // 2. Busca entre os grupos participantes do bot
    logger.info(`Procurando grupo com o nome "${config.whatsapp.groupName}"...`);
    const participatingGroups = await this.sock.groupFetchAllParticipating();
    const groupList = Object.values(participatingGroups);

    const targetName = config.whatsapp.groupName.trim().toLowerCase();
    const match = groupList.find((g) => g.subject && g.subject.trim().toLowerCase() === targetName);

    if (!match) {
      const available = groupList.map((g) => `"${g.subject}" (JID: ${g.id})`).join('\n - ');
      throw new Error(
        `Grupo "${config.whatsapp.groupName}" não foi encontrado.\nGrupos em que o bot está inserido:\n - ${available || 'Nenhum grupo encontrado'}`
      );
    }

    logger.info(`Grupo encontrado: "${match.subject}" (${match.id})`);
    this.cachedTargetJid = match.id;
    return this.cachedTargetJid;
  }

  /**
   * Envia uma postagem com imagem e legenda para o grupo do WhatsApp
   * @param {Buffer} imageBuffer Buffer da imagem
   * @param {string} mimeType Tipo MIME
   * @param {string} filename Nome do arquivo
   * @param {string} caption Legenda formatada
   */
  async sendImagePost(imageBuffer, mimeType, filename, caption) {
    await this.waitUntilOnline();
    const jid = await this.getTargetGroupJid();

    logger.info(`Enviando mensagem para o grupo [${jid}] via Baileys socket...`);
    const sent = await this.sock.sendMessage(jid, {
      image: imageBuffer,
      caption: caption,
      mimetype: mimeType || 'image/jpeg',
      fileName: filename,
    });

    logger.info(`Mensagem enviada com sucesso! (ID: ${sent.key.id})`);
    return sent;
  }

  /**
   * Retorna o status atual da conexão para o Dashboard web
   */
  getStatus() {
    return {
      status: this.status,
      botNumber: this.botNumber,
      groupName: config.whatsapp.groupName,
      lastConnected: this.lastConnected,
      qrDataUrl: this.qrDataUrl,
      lastError: this.lastError,
      isInitializing: this._isInitializing,
    };
  }
}

export const whatsappService = new WhatsAppService();
