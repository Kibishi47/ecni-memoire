import type { EngineCardModel } from '../types/cardModel'

/**
 * Registre de secours désactivé conformément aux exigences strictes de validation.
 * La SEULE source de vérité autorisée pour les Pokémon, Dresseurs et Énergies Spéciales
 * est le catalogue compilé `cards_database.json`.
 * Les Énergies de base sont générées nativement à la volée via `createNativeBasicEnergyModel`.
 */
export const FALLBACK_CARD_MODELS: Record<string, EngineCardModel> = {}
