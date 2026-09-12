import path from 'path';

/**
 * Tabela de preços oficial da CHB IMPORT
 */
export const DEFAULT_PRICES = {
  torcedor: 'R$ 149,90',
  jogador: 'R$ 169,99',
  retro: 'R$ 179,90',
  streetwear: 'R$ 65,00',
};

export const PRICE_TABLE_TEXT = `💰 *Valores:*
👕 Camisa Streetwear: *R$ 65,00*
⚽ Camisa de Torcedor: *R$ 149,90*
⚡ Camisa de Jogador: *R$ 169,99*
🏆 Camisa Retrô: *R$ 179,90*`;

/**
 * Extrai informações do produto e preço a partir do nome do arquivo.
 * Exemplo de entrada: "Real-Madrid-Home-24-25_Torcedor_149,90.jpg" ou "camiseta_stussy.jpg"
 *
 * @param {string} filename Nome do arquivo
 * @returns {{ title: string, version: string, price: string, hasExplicitPrice: boolean, rawName: string, summary: string }}
 */
export function parseFilename(filename) {
  const ext = path.extname(filename);
  const baseName = path.basename(filename, ext).trim();

  // Divide por underline "_" ou " - "
  const parts = baseName.includes('_') ? baseName.split('_') : baseName.split(' - ');

  let title = '';
  let version = '';
  let price = '';

  if (parts.length >= 3) {
    // Formato: [Produto]_[Versão]_[Preço]
    title = formatTitle(parts[0]);
    version = parts[1].replace(/[-_]/g, ' ').trim();
    if (looksLikePrice(parts[2])) {
      price = formatPrice(parts[2]);
    }
  } else if (parts.length === 2) {
    title = formatTitle(parts[0]);
    if (looksLikePrice(parts[1])) {
      price = formatPrice(parts[1]);
    } else {
      version = parts[1].replace(/[-_]/g, ' ').trim();
    }
  } else {
    title = formatTitle(baseName);
  }

  // Se ainda não encontrou preço, procura padrão monetário explícito (ex: "R$ 149" ou "149,90")
  // Ignorando padrões que sejam temporadas como "24-25", "26-27" ou anos "2024", "2025"
  if (!price) {
    const explicitPriceMatch = baseName.match(/(?:R\$\s*(\d{1,4}(?:[.,]\d{2})?))|(?<!\d[-/])\b(\d{2,4}[.,]\d{2})\b/i);
    if (explicitPriceMatch) {
      price = formatPrice(explicitPriceMatch[1] || explicitPriceMatch[2]);
    }
  }

  const hasExplicitPrice = Boolean(price);

  // Normaliza o texto substituindo delimitadores (_, -, ., /) por espaços para garantir correspondência precisa
  const normalizedContext = `${baseName} ${version}`.toLowerCase().replace(/[_\-./]/g, ' ');

  const isStreetwear = /\b(streetwear|street|oversized|camiseta|casual|tee|t-shirt|tshirt|regata|moletom|hoodie|stussy|supreme|trapstar|corteiz|bape|off white|offwhite|balenciaga|palace|vlone|essentials)\b/i.test(normalizedContext);
  const isJogador = /\b(jogador|player|atleta|authentic)\b/i.test(normalizedContext);
  const isRetro = /\b(retro|retrô|vintage|classica|clássica)\b/i.test(normalizedContext);
  const isTorcedor = /\b(torcedor|fan|stadium)\b/i.test(normalizedContext);

  if (isStreetwear) {
    version = 'Streetwear';
  } else if (isJogador) {
    version = 'Jogador';
  } else if (isRetro) {
    version = 'Retrô';
  } else if (isTorcedor) {
    version = 'Torcedor';
  } else {
    version = version || 'Torcedor';
  }

  // Se o preço não veio explícito no arquivo, usa a tabela de preços padrão conforme o modelo
  if (!price) {
    if (version === 'Streetwear') {
      price = DEFAULT_PRICES.streetwear;
    } else if (version === 'Jogador') {
      price = DEFAULT_PRICES.jogador;
    } else if (version === 'Retrô') {
      price = DEFAULT_PRICES.retro;
    } else {
      price = DEFAULT_PRICES.torcedor;
    }
  }

  const summary = `Produto: ${title} | Modelo: ${version} | Preço: ${price}`;

  return {
    title,
    version,
    price,
    hasExplicitPrice,
    rawName: baseName,
    summary,
    priceTable: DEFAULT_PRICES,
    priceTableText: PRICE_TABLE_TEXT,
  };
}

/**
 * Formata o título substituindo traços por espaços e ajustando temporadas (ex: 24-25 -> 24/25)
 */
function formatTitle(raw) {
  return raw
    .replace(/(\d{2})-(\d{2})/g, '$1/$2') // Ajusta 24-25 para 24/25
    .replace(/[-_]/g, ' ')
    .trim();
}

/**
 * Formata o valor para a moeda brasileira (ex: 149,90 -> R$ 149,90)
 */
function formatPrice(rawPrice) {
  const clean = rawPrice.replace(/[^\d.,]/g, '').trim();
  if (!clean) return 'Consulte o valor';
  
  const formatted = clean.includes(',') ? clean : clean.replace('.', ',');
  return `R$ ${formatted}`;
}

/**
 * Verifica se uma string parece um valor monetário real (e não um ano/temporada)
 */
function looksLikePrice(str) {
  const clean = str.trim();
  if (/^R\$/i.test(clean)) return true;
  // Tem centavos explícitos (ex: 149,90 ou 149.90)
  if (/\d+[.,]\d{2}/.test(clean)) return true;
  // Número inteiro: não pode ser ano (ex: 2024, 2025, 2026, 2027) nem temporada (24-25, 26-27)
  if (/^\d{2,3}$/.test(clean)) {
    const num = parseInt(clean, 10);
    // Anos ou temporadas comuns descartados
    if (num >= 20 && num <= 35) return false;
    return num >= 40;
  }
  return false;
}
