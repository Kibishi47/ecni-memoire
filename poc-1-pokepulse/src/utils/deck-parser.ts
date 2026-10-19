import type { CardItem, CardRole } from '../types/pokemon-tcg'

// Known dictionary for automatic classification
const SEARCH_KEYWORDS = ['ball', 'poffin', 'vessel', 'urne', 'encens', 'incense', 'capture', 'sélecteur', 'search']
const ACCELERATOR_KEYWORDS = ['bonbon', 'candy', 'civière', 'stretcher', 'canne', 'rod', 'tampon', 'stamp', 'ceinture', 'band', 'cape', 'charm', 'aspirateur', 'vacuum', 'tambour', 'drum', 'switch', 'échange', 'recup', 'retrieval', 'capsule', 'pokéstop', 'pokestop', 'stade', 'stadium', 'attrape-riposte', 'catcher']
const SUPPORTER_KEYWORDS = ['arven', 'iono', 'mashynn', 'boss', 'ordres', 'sada', 'olim', 'turo', 'turum', 'recherche', 'research', 'jacq', 'judith', 'pepper', 'tulipe', 'tulip', 'cythia', 'cynthia', 'n', 'mortimer', 'morty', 'colress', 'volo']
const ENERGY_KEYWORDS = ['énergie', 'energy', 'energ']
const EVOLUTION_KEYWORDS = ['reptincel', 'dracaufeu', 'charizard', 'charmeleon', 'roucarnage', 'pidgeot', 'roucoups', 'pidgeotto', 'kirlia', 'gardevoir', 'gallame', 'gallade', 'castorno', 'bibarel', 'maraiste', 'quagsire', 'lanssorien', 'dragapult', 'dispareptil', 'drakloak', 'ectoplasma', 'gengar', 'aligatueur', 'feraligatr', 'baxcalibur', 'cryodo', 'frigibax', 'arctibax']

export function inferCardRole(name: string): CardRole {
  const lower = name.toLowerCase()

  if (ENERGY_KEYWORDS.some(k => lower.includes(k))) {
    return 'energy'
  }
  if (SUPPORTER_KEYWORDS.some(k => lower.includes(k))) {
    return 'supporter'
  }
  if (SEARCH_KEYWORDS.some(k => lower.includes(k))) {
    return 'search_engine'
  }
  if (ACCELERATOR_KEYWORDS.some(k => lower.includes(k))) {
    return 'accelerator_item'
  }
  if (EVOLUTION_KEYWORDS.some(k => lower.includes(k)) || lower.includes(' vstar') || lower.includes(' vmax') || lower.includes(' ex') || lower.includes(' niv.')) {
    // Note: Some basic pokemon are "ex" (e.g. Ire-Foudre ex, Ogerpon ex, Mew ex, Tapatoes ex)
    // Check if it's a known basic ex
    const basicExes = ['ire-foudre', 'raging bolt', 'ogerpon', 'mew', 'tapatoès', 'squawkabilly', 'miraidon', 'koraidon', 'turtok', 'terapagos', 'fongus', 'rugit-lune', 'roaring moon', 'chi-yu', 'chien-pao', 'ting-lu', 'iron hands', 'paume-de-fer', 'iron crown', 'couronne-de-fer']
    if (basicExes.some(b => lower.includes(b))) {
      return 'basic_pokemon'
    }
    return 'evolution_pokemon'
  }

  // Default assumption for Pokémon vs items
  return 'basic_pokemon'
}

export function parsePtcglText(text: string): CardItem[] {
  const lines = text.split('\n')
  const cards: CardItem[] = []

  let currentCategoryHint: string | null = null

  for (let rawLine of lines) {
    const line = rawLine.trim()
    if (!line) continue

    // Detect section headers
    if (line.toLowerCase().startsWith('pokémon') || line.toLowerCase().startsWith('pokemon')) {
      currentCategoryHint = 'pokemon'
      continue
    }
    if (line.toLowerCase().startsWith('dresseur') || line.toLowerCase().startsWith('trainer')) {
      currentCategoryHint = 'trainer'
      continue
    }
    if (line.toLowerCase().startsWith('énergie') || line.toLowerCase().startsWith('energy')) {
      currentCategoryHint = 'energy'
      continue
    }

    // Standard regex: "4 Charmander MEW 4" or "4 Salamèche MEW 4" or "4 Buddy-Buddy Poffin TEF 144"
    // Also matches "4 Ultra Ball SVI 196" or "1 Radiant Greninja ASR 46"
    const match = line.match(/^(\d+)\s+(.+?)(?:\s+([A-Z0-9]{2,4})\s+(\d+))?$/i)

    if (match) {
      const count = parseInt(match[1], 10)
      let name = match[2].trim()
      const set = match[3] || 'PR-SV'
      const setNumber = match[4] || '1'

      let role: CardRole = inferCardRole(name)

      // Contextual override from section header if needed
      if (currentCategoryHint === 'energy' && role !== 'energy') {
        role = 'energy'
      }

      const isEx = name.toLowerCase().includes(' ex')
      const isV = name.toLowerCase().includes(' v') && !name.toLowerCase().includes('vessel')
      const isRadiant = name.toLowerCase().includes('radieux') || name.toLowerCase().includes('radiant')
      const isAceSpec = name.toLowerCase().includes('tambour') || name.toLowerCase().includes('tampon') || name.toLowerCase().includes('prime catcher') || name.toLowerCase().includes('attrape-suprême')

      cards.push({
        id: `${name.toLowerCase().replace(/[^a-z0-9]/g, '_')}_${set}_${setNumber}`,
        name,
        frenchName: name,
        count,
        role,
        set,
        setNumber,
        isEx,
        isV,
        isRadiant,
        isAceSpec,
        tag: isAceSpec ? 'ACE SPEC' : isRadiant ? 'Radieux' : isEx ? 'Pokémon ex' : undefined
      })
    }
  }

  return cards
}

export function formatCardsToPtcgl(cards: CardItem[]): string {
  const pokemons = cards.filter(c => c.role === 'basic_pokemon' || c.role === 'evolution_pokemon')
  const trainers = cards.filter(c => c.role === 'search_engine' || c.role === 'accelerator_item' || c.role === 'supporter')
  const energies = cards.filter(c => c.role === 'energy')

  let out = ''

  if (pokemons.length > 0) {
    const totalPokes = pokemons.reduce((s, c) => s + c.count, 0)
    out += `Pokémon: ${totalPokes}\n`
    for (const c of pokemons) {
      out += `${c.count} ${c.frenchName || c.name} ${c.set} ${c.setNumber}\n`
    }
    out += '\n'
  }

  if (trainers.length > 0) {
    const totalTrainers = trainers.reduce((s, c) => s + c.count, 0)
    out += `Dresseurs: ${totalTrainers}\n`
    for (const c of trainers) {
      out += `${c.count} ${c.frenchName || c.name} ${c.set} ${c.setNumber}\n`
    }
    out += '\n'
  }

  if (energies.length > 0) {
    const totalEnergies = energies.reduce((s, c) => s + c.count, 0)
    out += `Énergies: ${totalEnergies}\n`
    for (const c of energies) {
      out += `${c.count} ${c.frenchName || c.name} ${c.set} ${c.setNumber}\n`
    }
  }

  return out.trim()
}
