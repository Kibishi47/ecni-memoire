import type { EngineCardModel } from '../types/cardModel'

export interface TypeVisualInfo {
  nameFr: string
  bg: string
  text: string
  border: string
  icon: string
  emoji: string
}

export const TYPE_VISUALS: Record<string, TypeVisualInfo> = {
  feu: {
    nameFr: 'Feu',
    bg: 'bg-red-500',
    text: 'text-white',
    border: 'border-red-600',
    icon: 'Flame',
    emoji: '🔥',
  },
  eau: {
    nameFr: 'Eau',
    bg: 'bg-blue-500',
    text: 'text-white',
    border: 'border-blue-600',
    icon: 'Droplet',
    emoji: '💧',
  },
  plante: {
    nameFr: 'Plante',
    bg: 'bg-emerald-600',
    text: 'text-white',
    border: 'border-emerald-700',
    icon: 'Leaf',
    emoji: '🌿',
  },
  electrique: {
    nameFr: 'Électrique',
    bg: 'bg-amber-400',
    text: 'text-amber-950',
    border: 'border-amber-500',
    icon: 'Zap',
    emoji: '⚡',
  },
  psy: {
    nameFr: 'Psy',
    bg: 'bg-purple-600',
    text: 'text-white',
    border: 'border-purple-700',
    icon: 'Eye',
    emoji: '🔮',
  },
  combat: {
    nameFr: 'Combat',
    bg: 'bg-amber-800',
    text: 'text-white',
    border: 'border-amber-900',
    icon: 'Shield',
    emoji: '🥊',
  },
  obscurite: {
    nameFr: 'Obscurité',
    bg: 'bg-slate-900',
    text: 'text-white',
    border: 'border-slate-950',
    icon: 'Moon',
    emoji: '🌑',
  },
  metal: {
    nameFr: 'Métal',
    bg: 'bg-zinc-400',
    text: 'text-zinc-950',
    border: 'border-zinc-500',
    icon: 'Wrench',
    emoji: '⚙️',
  },
  fee: {
    nameFr: 'Fée',
    bg: 'bg-pink-400',
    text: 'text-pink-950',
    border: 'border-pink-500',
    icon: 'Sparkles',
    emoji: '✨',
  },
  incolore: {
    nameFr: 'Incolore',
    bg: 'bg-slate-300',
    text: 'text-slate-800',
    border: 'border-slate-400',
    icon: 'Circle',
    emoji: '⭐',
  },
}

export function normalizeTypeName(rawType: string): string {
  const norm = (rawType || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim()
  if (norm.includes('feu') || norm === 'r' || norm.includes('fire')) return 'feu'
  if (norm.includes('eau') || norm === 'w' || norm.includes('water')) return 'eau'
  if (norm.includes('plante') || norm === 'g' || norm.includes('grass')) return 'plante'
  if (norm.includes('electr') || norm === 'l' || norm.includes('light')) return 'electrique'
  if (norm.includes('psy') || norm === 'p') return 'psy'
  if (norm.includes('comb') || norm === 'f' || norm.includes('fight')) return 'combat'
  if (norm.includes('obsc') || norm === 'd' || norm.includes('dark')) return 'obscurite'
  if (norm.includes('met') || norm === 'm' || norm.includes('iron')) return 'metal'
  if (norm.includes('fee') || norm === 'y' || norm.includes('fair')) return 'fee'
  return 'incolore'
}

export function getTypeVisual(type: string): TypeVisualInfo {
  const norm = normalizeTypeName(type)
  return TYPE_VISUALS[norm] || TYPE_VISUALS.incolore!
}

export function getCardImageUrl(rawUrl: string | null | undefined): string | null {
  if (!rawUrl) return null
  const trimmed = rawUrl.trim()
  if (!trimmed) return null
  if (
    trimmed.includes('assets.tcgdex.net') &&
    !trimmed.endsWith('.webp') &&
    !trimmed.endsWith('.png') &&
    !trimmed.endsWith('.jpg')
  ) {
    return `${trimmed}/high.webp`
  }
  return trimmed
}

export function getCategoryBadge(card: EngineCardModel): { label: string; bg: string; text: string } {
  if (card.category === 'POKEMON') {
    const isRuleBox = card.identity.isRuleBox
    const stage = card.subCategory
    let label = 'Pokémon'
    if (stage === 'BASIC') label = isRuleBox ? 'Pokémon ex/V (Base)' : 'Pokémon (Base)'
    else if (stage === 'STAGE_1') label = isRuleBox ? 'Pokémon ex (N.1)' : 'Pokémon (N.1)'
    else if (stage === 'STAGE_2') label = isRuleBox ? 'Pokémon ex (N.2)' : 'Pokémon (N.2)'
    return {
      label,
      bg: isRuleBox ? 'bg-indigo-900' : 'bg-blue-600',
      text: 'text-white',
    }
  }

  if (card.category === 'TRAINER') {
    const sub = card.subCategory
    if (sub === 'SUPPORTER') {
      return { label: 'Supporter', bg: 'bg-amber-600', text: 'text-white' }
    }
    if (sub === 'ITEM') {
      return { label: card.identity.isAceSpec ? 'HIGH-TECH (Objet)' : 'Objet', bg: card.identity.isAceSpec ? 'bg-fuchsia-700' : 'bg-sky-600', text: 'text-white' }
    }
    if (sub === 'STADIUM') {
      return { label: 'Stade', bg: 'bg-emerald-700', text: 'text-white' }
    }
    if (sub === 'TOOL') {
      return { label: card.identity.isTechnicalMachine ? 'Machine Technique' : 'Outil', bg: 'bg-violet-700', text: 'text-white' }
    }
    return { label: 'Dresseur', bg: 'bg-slate-700', text: 'text-white' }
  }

  if (card.category === 'ENERGY') {
    const isSpecial = card.subCategory === 'SPECIAL_ENERGY'
    return {
      label: isSpecial ? 'Énergie Spéciale' : 'Énergie de base',
      bg: isSpecial ? 'bg-purple-800' : 'bg-emerald-600',
      text: 'text-white',
    }
  }

  return { label: 'Carte', bg: 'bg-slate-500', text: 'text-white' }
}

export function formatEnergyCost(
  energyCost?: Record<string, number> | string[],
): Array<{ type: string; count: number; visual: TypeVisualInfo }> {
  if (!energyCost) return []

  const counts: Record<string, number> = {}

  if (Array.isArray(energyCost)) {
    for (const t of energyCost) {
      const norm = normalizeTypeName(t)
      counts[norm] = (counts[norm] || 0) + 1
    }
  } else {
    for (const [k, count] of Object.entries(energyCost)) {
      if (count > 0) {
        const norm = normalizeTypeName(k)
        counts[norm] = (counts[norm] || 0) + count
      }
    }
  }

  return Object.entries(counts).map(([type, count]) => ({
    type,
    count,
    visual: getTypeVisual(type),
  }))
}
