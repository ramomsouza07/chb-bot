import { google } from 'googleapis';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';

class DriveService {
  constructor() {
    this.drive = null;
    this.sentFolderId = config.drive.sentFolderId;
  }

  /**
   * Inicializa o cliente autenticado do Google Drive com Service Account
   */
  async init() {
    if (this.drive) return this.drive;

    try {
      const auth = new google.auth.GoogleAuth({
        keyFile: config.drive.credentialsPath,
        scopes: ['https://www.googleapis.com/auth/drive'],
      });

      this.drive = google.drive({ version: 'v3', auth });
      logger.info('Google Drive Service autenticado com sucesso.');
      return this.drive;
    } catch (error) {
      logger.error('Erro ao autenticar com o Google Drive:', error.message);
      throw error;
    }
  }

  /**
   * Obtém uma imagem aleatória da pasta de produtos
   * @param {string} folderId ID da pasta no Drive
   * @returns {Promise<{ id: string, name: string, mimeType: string } | null>}
   */
  async getRandomImage(folderId = config.drive.folderId) {
    await this.init();

    logger.info(`Buscando imagens disponíveis na pasta [${folderId}]...`);

    const query = `'${folderId}' in parents and mimeType contains 'image/' and trashed = false`;
    const res = await this.drive.files.list({
      q: query,
      fields: 'files(id, name, mimeType, size)',
      pageSize: 100,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    });

    const files = res.data.files;
    if (!files || files.length === 0) {
      logger.warn('Nenhuma imagem pendente encontrada na pasta do Google Drive.');
      return null;
    }

    logger.info(`${files.length} imagem(ns) encontrada(s). Selecionando aleatoriamente...`);
    const randomIndex = Math.floor(Math.random() * files.length);
    const chosenFile = files[randomIndex];

    logger.info(`Imagem selecionada: "${chosenFile.name}" (ID: ${chosenFile.id})`);
    return chosenFile;
  }

  /**
   * Faz o download do arquivo de imagem direto para um Buffer em memória
   * @param {string} fileId ID do arquivo
   * @returns {Promise<Buffer>}
   */
  async downloadImageBuffer(fileId) {
    await this.init();

    logger.info(`Baixando imagem [${fileId}] em memória...`);
    const res = await this.drive.files.get(
      { fileId, alt: 'media', supportsAllDrives: true },
      { responseType: 'arraybuffer' }
    );

    const buffer = Buffer.from(res.data);
    logger.info(`Download concluído. Tamanho: ${(buffer.length / 1024).toFixed(2)} KB.`);
    return buffer;
  }

  /**
   * Localiza ou cria a subpasta "Enviadas" dentro da pasta de produtos
   * @param {string} parentFolderId ID da pasta pai
   * @returns {Promise<string>} ID da pasta "Enviadas"
   */
  async getOrCreateSentFolder(parentFolderId = config.drive.folderId) {
    if (this.sentFolderId) return this.sentFolderId;

    await this.init();

    // 1. Procura se já existe a pasta "Enviadas" dentro da pasta pai
    const query = `'${parentFolderId}' in parents and name = 'Enviadas' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
    const searchRes = await this.drive.files.list({
      q: query,
      fields: 'files(id, name)',
      pageSize: 1,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    });

    if (searchRes.data.files && searchRes.data.files.length > 0) {
      this.sentFolderId = searchRes.data.files[0].id;
      logger.info(`Subpasta "Enviadas" encontrada (ID: ${this.sentFolderId}).`);
      return this.sentFolderId;
    }

    // 2. Se não existir, cria a subpasta
    logger.info('Subpasta "Enviadas" não encontrada. Criando automaticamente...');
    const createRes = await this.drive.files.create({
      requestBody: {
        name: 'Enviadas',
        mimeType: 'application/vnd.google-apps.folder',
        parents: [parentFolderId],
      },
      fields: 'id',
      supportsAllDrives: true,
    });

    this.sentFolderId = createRes.data.id;
    logger.info(`Subpasta "Enviadas" criada com sucesso (ID: ${this.sentFolderId}).`);
    return this.sentFolderId;
  }

  /**
   * Move o arquivo da pasta principal para a subpasta "Enviadas"
   * @param {string} fileId ID do arquivo
   * @param {string} currentFolderId ID da pasta de origem
   */
  async moveFileToSent(fileId, currentFolderId = config.drive.folderId) {
    await this.init();
    const sentFolderId = await this.getOrCreateSentFolder(currentFolderId);

    logger.info(`Movendo arquivo [${fileId}] para a pasta "Enviadas"...`);
    await this.drive.files.update({
      fileId,
      addParents: sentFolderId,
      removeParents: currentFolderId,
      fields: 'id, parents',
      supportsAllDrives: true,
    });

    logger.info(`Arquivo [${fileId}] movido com sucesso para "Enviadas".`);
  }
}

export const driveService = new DriveService();
