import { lookupSetMapping } from '../data/ptcglSetMapping'
import type { EngineCardModel } from '../types/cardModel'
import type { ParsedDeckEntry } from '../types/deck'

/**
 * Retourne l'URL de miniature haute performance pour une carte du deck ou du catalogue.
 * Priorise le format WebP compact (low.webp) heberge sur le CDN officiel TCGdex.
 */
export function getCardImageUrl(
  card:
    | ParsedDeckEntry
    | EngineCardModel
    | {
        identity?: { imageUrl?: string | null; cardId?: string }
        cardId?: string
        setCode?: string
        number?: string
        imageUrl?: string | null
      }
    | null
    | undefined,
): string | null {
  if (!card) return null

  // 1. URL directe fournie par le modele ou l'entree de deck
  const directUrl =
    ('imageUrl' in card && typeof card.imageUrl === 'string' && card.imageUrl) ||
    ('identity' in card && typeof card.identity?.imageUrl === 'string' && card.identity.imageUrl) ||
    null

  if (directUrl) {
    if (directUrl.endsWith('.webp') || directUrl.endsWith('.png') || directUrl.endsWith('.jpg')) {
      return directUrl
    }
    return `${directUrl}/low.webp`
  }

  // 2. Synthese a partir du cardId standardise (ex: "sv03-125", "me01-104", "sv06-130")
  const rawCardId =
    ('cardId' in card && typeof card.cardId === 'string' ? card.cardId : null) ||
    ('identity' in card && typeof card.identity?.cardId === 'string' ? card.identity.cardId : null)

  if (rawCardId && rawCardId.includes('-')) {
    const [setId, rawNum] = rawCardId.split('-')
    if (setId && rawNum) {
      const mapping = lookupSetMapping(setId)
      const cleanNum = rawNum.replace(/^0+/, '') || '1'
      const paddedNum = cleanNum.padStart(3, '0')
      return `https://assets.tcgdex.net/fr/${mapping.serie}/${mapping.setId}/${paddedNum}/low.webp`
    }
  }

  // 3. Synthese a partir de setCode et number (tokens PTCGL)
  if (
    'setCode' in card &&
    typeof card.setCode === 'string' &&
    'number' in card &&
    typeof card.number === 'string'
  ) {
    const mapping = lookupSetMapping(card.setCode)
    const cleanNum = card.number.replace(/^0+/, '') || '1'
    const paddedNum = cleanNum.padStart(3, '0')
    return `https://assets.tcgdex.net/fr/${mapping.serie}/${mapping.setId}/${paddedNum}/low.webp`
  }

  return null
}
