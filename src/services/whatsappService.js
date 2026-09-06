import makeWASocket, {
  DisconnectReason,
  fetchLatestBaileysVersion,
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
  }

  /**
   * Inicializa o socket do Baileys com persistência de sessão no PostgreSQL/Neon via Prisma
   */
  async initialize() {
    if (this._isInitializing) return this._onlinePromise;
    this._isInitializing = true;

    this._onlinePromise = new Promise((resolve) => {
      this._resolveOnline = resolve;
    });

    try {
      logger.info('Carregando estado de autenticação do Prisma...');
      const { state, saveCreds, clearSession } = await usePrismaAuthState(config.whatsapp.sessionId);
      this.clearSession = clearSession;

      const { version } = await fetchLatestBaileysVersion();
      logger.info(`Conectando ao WhatsApp via Baileys (versão WA: ${version.join('.')})...`);

      this.sock = makeWASocket({
        version,
        auth: state,
        logger: pino({ level: 'silent' }),
        printQRInTerminal: false,
        browser: ['CHB IMPORT', 'Chrome', '1.0.0'],
        connectTimeoutMs: 60000,
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
          this.status = 'connecting';
          logger.info('Estabelecendo conexão com o WhatsApp...');
        }

        if (connection === 'open') {
          this.status = 'online';
          this.qrRaw = null;
          this.qrDataUrl = null;
          this.lastConnected = new Date();
          this.botNumber = this.sock.user?.id ? this.sock.user.id.split(':')[0] : 'Conectado';

          logger.info(`✅ 🤖 Baileys WhatsApp CONECTADO COM SUCESSO! (Número: ${this.botNumber})`);
          if (this._resolveOnline) {
            this._resolveOnline(this.sock);
          }
        }

        if (connection === 'close') {
          this.status = 'disconnected';
          const error = lastDisconnect?.error;
          const statusCode = error instanceof Boom ? error.output?.statusCode : null;
          const reason = DisconnectReason[statusCode] || 'Desconhecido';

          logger.warn(`Conexão do WhatsApp fechada. Código: ${statusCode} (${reason}).`);

          const isLoggedOut = statusCode === DisconnectReason.loggedOut;
          if (isLoggedOut) {
            logger.warn('A sessão foi desconectada pelo aparelho. Limpando chaves no banco de dados...');
            await this.clearSession();
          }

          // Reconecta automaticamente após breve intervalo
          logger.info('Tentando restabelecer conexão em 4 segundos...');
          setTimeout(() => {
            this._isInitializing = false;
            this.initialize();
          }, 4000);
        }
      });

      return this._onlinePromise;
    } catch (err) {
      this.status = 'error';
      this._isInitializing = false;
      logger.error('Erro crítico ao inicializar Baileys:', err.message);
      throw err;
    }
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
    };
  }
}

export const whatsappService = new WhatsAppService();
