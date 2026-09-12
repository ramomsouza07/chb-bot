import { GoogleGenerativeAI } from '@google/generative-ai';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';
import { PRICE_TABLE_TEXT } from '../utils/parser.js';

/**
 * Garante que camisas streetwear nunca sejam anunciadas com o preço de torcedor (R$ 149)
 */
function sanitizeCaption(text, productInfo) {
  if (!text) return text;

  const isStreetwear = productInfo.version === 'Streetwear';

  if (isStreetwear) {
    const parts = text.split(/(?:💰\s*\*?Valores:?\*?|Tabela de Valores)/i);
    if (parts.length >= 2) {
      let mainDesc = parts[0];
      const rest = text.slice(mainDesc.length);
      mainDesc = mainDesc.replace(/(\*?)\s*R\$\s*149(?:[.,]90)?\s*(\*?)/gi, '$1R$ 65,00$2');
      return mainDesc + rest;
    } else {
      return text.replace(/(\*?)\s*R\$\s*149(?:[.,]90)?\s*(\*?)/gi, '$1R$ 65,00$2');
    }
  }
  return text;
}

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
Você é o copywriter e vendedor oficial da loja CHB IMPORT (especializada em camisas de futebol e camisetas streetwear).
Crie uma legenda vendedora, persuasiva, empolgante e com emojis para postar no WhatsApp baseada na IMAGEM e nos detalhes do produto.

DADOS IDENTIFICADOS DO PRODUTO:
- Nome/Item: ${productInfo.title}
- Modelo/Categoria: ${productInfo.version}
- Preço da peça: ${productInfo.price}

TABELA OFICIAL DE VALORES DA LOJA (ESTRITAMENTE OBRIGATÓRIA):
👕 Camisa Streetwear: R$ 65,00
⚽ Camisa de Torcedor: R$ 149,90
⚡ Camisa de Jogador: R$ 169,99
🏆 Camisa Retrô: R$ 179,90

⚠️ ATENÇÃO EXTREMA AOS PREÇOS - REGRA INEGOCIÁVEL:
1. SE A PEÇA DA IMAGEM FOR STREETWEAR (camiseta casual, oversized, estampa urbana de marcas como Nike casual, Stussy, Supreme, Trapstar, etc.):
   - O PREÇO DESTA PEÇA É OBRIGATORIAMENTE R$ 65,00!
   - NUNCA coloque R$ 149,90 para peça streetwear!
   - O valor de R$ 149,90 é EXCLUSIVO para camisa de time de futebol versão Torcedor!
   - Destaque no corpo da mensagem: "💰 Por apenas *R$ 65,00*!".
2. SE A PEÇA DA IMAGEM FOR CAMISA DE TIME DE FUTEBOL:
   - Modelo Torcedor: *R$ 149,90*
   - Modelo Jogador: *R$ 169,99*
   - Modelo Retrô: *R$ 179,90*

DIRETRIZES DA LEGENDA:
1. Comece com uma chamada animada destacando o produto com emojis (🔥, 👕, ⚡, ⚽).
2. Destaque o VALOR EXATO da peça que está na foto (se for streetwear, é R$ 65,00; se for futebol torcedor, é R$ 149,90).
3. Ao final da mensagem, inclua a tabela completa de valores da loja:
${PRICE_TABLE_TEXT}
4. Chamada para ação (CTA): convide a chamar no direct/privado para pedir o tamanho e garantir a peça.
5. Texto conciso (2 a 4 parágrafos curtos) com ótima formatação para WhatsApp.
    `.trim();

    logger.info('Enviando imagem e dados do produto para análise no Gemini Vision...');

    const imagePart = this.fileToGenerativePart(imageBuffer, mimeType);

    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const result = await this.model.generateContent([promptText, imagePart]);
        const response = await result.response;
        const text = response.text().trim();

        const cleanText = sanitizeCaption(text, productInfo);
        logger.info('Legenda gerada com sucesso pela IA!');
        return cleanText;
      } catch (error) {
        logger.warn(`Tentativa ${attempt}/2 falhou no Gemini AI: ${error.message}`);
        if (attempt < 2 && (error.message.includes('503') || error.message.includes('429'))) {
          logger.info('Aguardando 2 segundos para tentar novamente...');
          await new Promise((r) => setTimeout(r, 2000));
        } else {
          logger.error('Falha definitiva ao gerar legenda com Gemini. Usando legenda padrão da loja.');
          const isStreet = productInfo.version === 'Streetwear';
          const priceDisplay = isStreet ? '💰 Preço: *R$ 65,00*' : `💰 Preço: *${productInfo.price || 'R$ 149,90'}*`;
          return `⚽ *CHB IMPORT* ⚽\n\n🔥 *${productInfo.title}*\n👕 Modelo: ${productInfo.version}\n${priceDisplay}\n\n${PRICE_TABLE_TEXT}\n\n📦 Garanta já a sua peça no direct! Poucas unidades disponíveis!\n🚀 Enviamos para todo o Brasil!`;
        }
      }
    }
  }
}

export const aiService = new AIService();
