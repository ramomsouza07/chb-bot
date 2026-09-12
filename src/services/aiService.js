import { GoogleGenerativeAI } from '@google/generative-ai';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';
import { PRICE_TABLE_TEXT } from '../utils/parser.js';

class AIService {
  constructor() {
    this.genAI = null;
    this.model = null;
  }

  /**
   * Inicializa o cliente do Gemini
   */
  init() {
    if (this.genAI) return;
    this.genAI = new GoogleGenerativeAI(config.gemini.apiKey);
    this.model = this.genAI.getGenerativeModel({ model: config.gemini.model });
    logger.info(`Gemini AI Service inicializado com o modelo: ${config.gemini.model}`);
  }

  /**
   * Converte um buffer de imagem para a estrutura aceita pelo Gemini
   * @param {Buffer} buffer
   * @param {string} mimeType
   */
  fileToGenerativePart(buffer, mimeType = 'image/jpeg') {
    return {
      inlineData: {
        data: buffer.toString('base64'),
        mimeType,
      },
    };
  }

  /**
   * Gera uma legenda persuasiva para a imagem e produto
   * @param {Buffer} imageBuffer Buffer da imagem
   * @param {string} mimeType Tipo MIME da imagem
   * @param {{ title: string, version: string, price: string, summary: string }} productInfo
   * @returns {Promise<string>}
   */
  async generateCaption(imageBuffer, mimeType, productInfo) {
    this.init();

    const promptText = `
Você é um vendedor da loja CHB IMPORT (especializada em camisas de futebol e artigos esportivos/streetwear). Crie uma legenda curta, altamente persuasiva, vendedora e com emojis para o WhatsApp baseada na imagem e nos detalhes do produto.

Dados do produto:
- Produto/Time: ${productInfo.title}
- Modelo/Versão: ${productInfo.version}
- Preço da peça: ${productInfo.price}

Tabela oficial de valores da CHB IMPORT:
- Camisa de Torcedor: R$ 149,90
- Camisa de Jogador: R$ 169,99
- Camisa Retrô: R$ 179,90
- Camisa Streetwear: R$ 65,00

Diretrizes obrigatórias:
1. Tom persuasivo, empolgante e amigável (estilo vendedor apaixonado por futebol e streetwear).
2. É OBRIGATÓRIO incluir na legenda a relação completa com os valores da loja:
${PRICE_TABLE_TEXT}
(Se a peça for um modelo específico, cite o modelo e o valor dela no texto, mas sempre mantenha a tabela completa de valores para os clientes).
3. Use emojis estratégicos (⚽, 🔥, 🏆, 📦, ⚡, 👕).
4. Texto conciso, ideal para leitura rápida no WhatsApp (2 a 4 parágrafos curtos).
5. Inclua uma chamada para ação (Call to Action) forte convidando a chamar no direct/privado para pedir o tamanho e garantir o manto.
    `.trim();

    logger.info('Enviando imagem e dados do produto para análise no Gemini Vision...');

    const imagePart = this.fileToGenerativePart(imageBuffer, mimeType);

    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const result = await this.model.generateContent([promptText, imagePart]);
        const response = await result.response;
        const text = response.text().trim();

        logger.info('Legenda gerada com sucesso pela IA!');
        return text;
      } catch (error) {
        logger.warn(`Tentativa ${attempt}/2 falhou no Gemini AI: ${error.message}`);
        if (attempt < 2 && (error.message.includes('503') || error.message.includes('429'))) {
          logger.info('Aguardando 2 segundos para tentar novamente...');
          await new Promise((r) => setTimeout(r, 2000));
        } else {
          logger.error('Falha definitiva ao gerar legenda com Gemini. Usando legenda padrão da loja.');
          return `⚽ *CHB IMPORT* ⚽\n\n🔥 *${productInfo.title}*\n👕 Modelo: ${productInfo.version}\n\n${PRICE_TABLE_TEXT}\n\n📦 Garanta já o seu manto no direct! Poucas unidades disponíveis!\n🚀 Enviamos para todo o Brasil!`;
        }
      }
    }
  }
}

export const aiService = new AIService();
