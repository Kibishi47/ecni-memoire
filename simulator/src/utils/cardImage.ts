import { lookupSetMapping } from '../data/ptcglSetMapping'
import type { EngineCardModel } from '../types/cardModel'
import type { ParsedDeckEntry } from '../types/deck'
import { detectBasicEnergy } from './energy'

/**
 * URLs officielles des énergies de base Scarlet & Violet (Limitless CDN).
 * Rendu haute résolution et instantané pour les 9 types d'énergies de base.
 */
const BASIC_ENERGY_IMAGE_MAP: Record<string, string> = {
  '1': 'https://limitlesstcg.nyc3.cdn.digitaloceanspaces.com/tpci/SVE/SVE_001_R_EN.png', // Plante
  '2': 'https://limitlesstcg.nyc3.cdn.digitaloceanspaces.com/tpci/SVE/SVE_002_R_EN.png', // Feu
  '3': 'https://limitlesstcg.nyc3.cdn.digitaloceanspaces.com/tpci/SVE/SVE_003_R_EN.png', // Eau
  '4': 'https://limitlesstcg.nyc3.cdn.digitaloceanspaces.com/tpci/SVE/SVE_004_R_EN.png', // Électrik
  '5': 'https://limitlesstcg.nyc3.cdn.digitaloceanspaces.com/tpci/SVE/SVE_005_R_EN.png', // Psy
  '6': 'https://limitlesstcg.nyc3.cdn.digitaloceanspaces.com/tpci/SVE/SVE_006_R_EN.png', // Combat
  '7': 'https://limitlesstcg.nyc3.cdn.digitaloceanspaces.com/tpci/SVE/SVE_007_R_EN.png', // Obscurité
  '8': 'https://limitlesstcg.nyc3.cdn.digitaloceanspaces.com/tpci/SVE/SVE_008_R_EN.png', // Métal
  '9': 'https://limitlesstcg.nyc3.cdn.digitaloceanspaces.com/tpci/SVE/SVE_009_R_EN.png', // Fée
}

/**
 * Mappage spécifique des numéros MEE vers les numéros SVE officiels.
 * MEE 9=Plante (1), 10=Feu (2), 11=Eau (3), 12=Électrique (4), 13=Psy (5), 14=Combat (6), 15=Obscurité (7), 16=Métal (8).
 */
const MEE_TO_SVE_NUMBER_MAP: Record<string, string> = {
  '9': '1',
  '10': '2',
  '11': '3',
  '12': '4',
  '13': '5',
  '14': '6',
  '15': '7',
  '16': '8',
}

/**
 * Retourne l'URL d'image d'une carte du deck ou du catalogue.
 * Gère nativement les énergies de base et supporte le mode 'low' (miniature) ou 'high' (zoom haute résolution).
 */
export function getCardImageUrl(
  card:
    | ParsedDeckEntry
    | EngineCardModel
    | {
        identity?: { imageUrl?: string | null; cardId?: string; nameFr?: string; nameEn?: string }
        model?: { identity?: { imageUrl?: string | null; cardId?: string; nameFr?: string; nameEn?: string } }
        cardId?: string
        nameFr?: string
        nameEn?: string
        setCode?: string
        number?: string
        imageUrl?: string | null
        subCategory?: string
        category?: string
      }
    | null
    | undefined,
  size: 'low' | 'high' = 'low',
): string | null {
  if (!card) return null

  // 1. Détection prioritaire des Énergies de Base (Plante, Feu, Eau, Psy, Combat, Obscurité, etc.)
  const cardName =
    ('nameFr' in card && typeof card.nameFr === 'string' && card.nameFr) ||
    ('nameEn' in card && typeof card.nameEn === 'string' && card.nameEn) ||
    ('identity' in card && card.identity?.nameFr) ||
    ('identity' in card && card.identity?.nameEn) ||
    ('model' in card && card.model?.identity?.nameFr) ||
    ('model' in card && card.model?.identity?.nameEn) ||
    ''

  const rawCardId =
    ('cardId' in card && typeof card.cardId === 'string' ? card.cardId : null) ||
    ('identity' in card && card.identity?.cardId) ||
    ('model' in card && card.model?.identity?.cardId) ||
    null

  const setCode =
    'setCode' in card && typeof card.setCode === 'string' ? card.setCode.toUpperCase() : null
  const number = 'number' in card && typeof card.number === 'string' ? card.number : null

  // Vérification de base via detectBasicEnergy
  const basicEnergyInfo = detectBasicEnergy(cardName, number || undefined)
  if (basicEnergyInfo) {
    const sveNum = basicEnergyInfo.sveNumber
    if (BASIC_ENERGY_IMAGE_MAP[sveNum]) {
      return BASIC_ENERGY_IMAGE_MAP[sveNum]
    }
  }

  // Vérification par setCode MEE pour les énergies de base
  if (setCode === 'MEE' && number && MEE_TO_SVE_NUMBER_MAP[number]) {
    const mappedSve = MEE_TO_SVE_NUMBER_MAP[number]
    return BASIC_ENERGY_IMAGE_MAP[mappedSve] || null
  }

  // Vérification par cardId SVE (sve-001 ... sve-009)
  if (rawCardId && rawCardId.toLowerCase().startsWith('sve-')) {
    const numPart = rawCardId.split('-')[1]?.replace(/^0+/, '') || '1'
    if (BASIC_ENERGY_IMAGE_MAP[numPart]) {
      return BASIC_ENERGY_IMAGE_MAP[numPart]
    }
  }

  // 2. URL directe fournie par le modèle ou l'entrée de deck
  const directUrl =
    ('imageUrl' in card && typeof card.imageUrl === 'string' && card.imageUrl) ||
    ('identity' in card && typeof card.identity?.imageUrl === 'string' && card.identity.imageUrl) ||
    ('model' in card && typeof card.model?.identity?.imageUrl === 'string' && card.model.identity.imageUrl) ||
    null

  if (directUrl) {
    if (directUrl.endsWith('.png') || directUrl.endsWith('.jpg')) {
      return directUrl
    }
    if (directUrl.endsWith('.webp')) {
      return size === 'high'
        ? directUrl.replace('/low.webp', '/high.webp')
        : directUrl.replace('/high.webp', '/low.webp')
    }
    return `${directUrl}/${size}.webp`
  }

  // 3. Synthèse à partir du cardId standardisé (ex: "sv03-125", "me01-104", "sv06-130")
  if (rawCardId && rawCardId.includes('-')) {
    const [setId, rawNum] = rawCardId.split('-')
    if (setId && rawNum) {
      const mapping = lookupSetMapping(setId)
      const cleanNum = rawNum.replace(/^0+/, '') || '1'
      const paddedNum = cleanNum.padStart(3, '0')
      return `https://assets.tcgdex.net/fr/${mapping.serie}/${mapping.setId}/${paddedNum}/${size}.webp`
    }
  }

  // 4. Synthèse à partir de setCode et number (tokens PTCGL)
  if (setCode && number) {
    const mapping = lookupSetMapping(setCode)
    const cleanNum = number.replace(/^0+/, '') || '1'
    const paddedNum = cleanNum.padStart(3, '0')
    return `https://assets.tcgdex.net/fr/${mapping.serie}/${mapping.setId}/${paddedNum}/${size}.webp`
  }

  return null
}
