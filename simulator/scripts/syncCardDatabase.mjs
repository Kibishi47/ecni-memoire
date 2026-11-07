import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const candidateSourcePaths = [
  path.resolve(__dirname, '../../card-compiler/data/cards_database.json'),
  path.resolve(process.cwd(), '../card-compiler/data/cards_database.json'),
  path.resolve(process.cwd(), 'card-compiler/data/cards_database.json'),
]

const candidateOldPaths = [
  path.resolve(__dirname, '../../card-compiler/data/old_compiled_cards'),
  path.resolve(process.cwd(), '../card-compiler/data/old_compiled_cards'),
  path.resolve(process.cwd(), 'card-compiler/data/old_compiled_cards'),
]

const candidateCompiledPaths = [
  path.resolve(__dirname, '../../card-compiler/data/compiled_cards'),
  path.resolve(process.cwd(), '../card-compiler/data/compiled_cards'),
  path.resolve(process.cwd(), 'card-compiler/data/compiled_cards'),
]

const targetPath = path.resolve(__dirname, '../src/data/cards_database.json')

let sourcePath = candidateSourcePaths.find((p) => fs.existsSync(p)) || null
let oldDir = candidateOldPaths.find((p) => fs.existsSync(p)) || null
let compiledDir = candidateCompiledPaths.find((p) => fs.existsSync(p)) || null

const targetDir = path.dirname(targetPath)
if (!fs.existsSync(targetDir)) {
  fs.mkdirSync(targetDir, { recursive: true })
}

const META_REFERENCE_CARD_IDS = [
  'sv03-125', // Dracaufeu-ex
  'sv05-123', // Ire-Foudre-ex
  'sv06.5-038', // Favianos-ex
  'sv04-125', // Super Bonbon
  'sv01-166', // Pepper
  'sv02-185', // Mashynn
  'sv01-196', // Hyper Ball
  'sv05-144', // Poffin Copain-Copain
  'sv01-181', // Faiblo Ball
  'sv03-164', // Roucarnage-ex
  'sv04-160', // Attrape-Riposte
]

function targetFilterToDsl(rawFilter) {
  if (!rawFilter) return null
  if (typeof rawFilter === 'string') {
    const s = rawFilter.trim()
    return s && s.toLowerCase() !== 'null' && s.toLowerCase() !== 'none' ? s : null
  }
  if (typeof rawFilter !== 'object') return null

  const parts = []
  if (rawFilter.category) parts.push(`CATEGORY:${String(rawFilter.category).toUpperCase()}`)
  const sub = rawFilter.subCategory || rawFilter.sub || rawFilter.subcategory
  if (sub) parts.push(`SUB:${String(sub).toUpperCase()}`)
  const stage = rawFilter.stage || (rawFilter.subCategory === 'BASIC' ? 'BASIC' : null)
  if (stage && !parts.some((p) => p.startsWith('SUB:BASIC') && stage === 'BASIC')) {
    parts.push(`STAGE:${String(stage).toUpperCase()}`)
  }
  const energyType = rawFilter.energyType || rawFilter.type
  if (energyType) parts.push(`TYPE:${String(energyType)}`)
  const maxHp = rawFilter.maxHp ?? rawFilter.maxHP
  if (typeof maxHp === 'number' && !isNaN(maxHp)) parts.push(`MAX_HP:${maxHp}`)
  const minHp = rawFilter.minHp ?? rawFilter.minHP
  if (typeof minHp === 'number' && !isNaN(minHp)) parts.push(`MIN_HP:${minHp}`)
  const name = rawFilter.specificCardName || rawFilter.name || rawFilter.cardName
  if (name) parts.push(`NAME:${String(name)}`)
  const isRuleBox = rawFilter.isRuleBox ?? rawFilter.ruleBox
  if (typeof isRuleBox === 'boolean') parts.push(`RULE_BOX:${isRuleBox ? 'TRUE' : 'FALSE'}`)
  const isTera = rawFilter.isTera ?? rawFilter.tera
  if (typeof isTera === 'boolean') parts.push(`TERA:${isTera ? 'TRUE' : 'FALSE'}`)
  const isAncient = rawFilter.isAncient ?? rawFilter.ancient
  if (typeof isAncient === 'boolean') parts.push(`ANCIENT:${isAncient ? 'TRUE' : 'FALSE'}`)
  const isFuture = rawFilter.isFuture ?? rawFilter.future
  if (typeof isFuture === 'boolean') parts.push(`FUTURE:${isFuture ? 'TRUE' : 'FALSE'}`)
  return parts.length > 0 ? parts.join('|') : null
}

function coerceEffectPrimitive(raw) {
  const s = String(raw || '').trim().toUpperCase().replace(/[\s-]+/g, '_')
  const map = {
    SEARCH_DECK: 'SEARCH_DECK',
    SEARCH_DECK_TO_HAND: 'SEARCH_DECK',
    SEARCH_DECK_TO_BENCH: 'SEARCH_DECK',
    SEARCH_DECK_AND_PUT_ON_BENCH: 'SEARCH_DECK',
    SEARCH_CARD: 'SEARCH_DECK',
    SEARCH: 'SEARCH_DECK',
    TUTOR: 'SEARCH_DECK',
    LOOK_TOP_DECK: 'SEARCH_DECK',
    LOOK_TOP_DECK_PICK: 'SEARCH_DECK',
    DRAW_CARDS: 'DRAW_CARDS',
    DRAW: 'DRAW_CARDS',
    DRAW_CARD: 'DRAW_CARDS',
    DRAW_UNTIL_HAND_SIZE: 'DRAW_CARDS',
    DRAW_UNTIL: 'DRAW_CARDS',
    DAMAGE_ACTIVE: 'DAMAGE_ACTIVE',
    DEAL_DAMAGE_ACTIVE: 'DAMAGE_ACTIVE',
    DEAL_DAMAGE: 'DAMAGE_ACTIVE',
    DAMAGE: 'DAMAGE_ACTIVE',
    ATTACK_DAMAGE: 'DAMAGE_ACTIVE',
    DAMAGE_BENCH: 'DAMAGE_BENCH',
    DEAL_DAMAGE_BENCH: 'DAMAGE_BENCH',
    PLACE_DAMAGE_COUNTERS: 'DAMAGE_BENCH',
    PUT_DAMAGE_COUNTERS: 'DAMAGE_BENCH',
    SNIPE_BENCH: 'DAMAGE_BENCH',
    SPREAD_DAMAGE: 'DAMAGE_BENCH',
    ATTACH_ENERGY: 'ATTACH_ENERGY',
    ATTACH_ENERGY_FROM_HAND: 'ATTACH_ENERGY',
    ATTACH_ENERGY_FROM_DISCARD: 'ATTACH_ENERGY',
    ATTACH_ENERGY_FROM_DECK: 'ATTACH_ENERGY',
    SEARCH_AND_ATTACH_ENERGY: 'ATTACH_ENERGY',
    ATTACH_EXTRA_ENERGY_FROM_HAND: 'ATTACH_ENERGY',
    ACCELERATE_ENERGY: 'ATTACH_ENERGY',
    MOVE_ENERGY_BETWEEN_POKEMON: 'ATTACH_ENERGY',
    MOVE_ENERGY: 'ATTACH_ENERGY',
    PROVIDE_ENERGY: 'ATTACH_ENERGY',
    DISCARD_CARDS: 'DISCARD_CARDS',
    DISCARD: 'DISCARD_CARDS',
    DISCARD_FROM_HAND: 'DISCARD_CARDS',
    DISCARD_HAND: 'DISCARD_CARDS',
    DISCARD_ENERGY: 'DISCARD_CARDS',
    DISCARD_STADIUM: 'DISCARD_CARDS',
    DISCARD_TOOL: 'DISCARD_CARDS',
    HEAL: 'HEAL',
    HEAL_DAMAGE: 'HEAL',
    HEAL_POKEMON: 'HEAL',
    REMOVE_DAMAGE_COUNTERS: 'HEAL',
    SWITCH_ACTIVE: 'SWITCH_ACTIVE',
    SWITCH_ACTIVE_POKEMON: 'SWITCH_ACTIVE',
    GUST_OPPONENT_BENCH_TO_ACTIVE: 'SWITCH_ACTIVE',
    GUST_OPPONENT_BENCH: 'SWITCH_ACTIVE',
    SWITCH: 'SWITCH_ACTIVE',
    GUST: 'SWITCH_ACTIVE',
    APPLY_SPECIAL_CONDITION: 'APPLY_SPECIAL_CONDITION',
    EVOLVE_POKEMON: 'EVOLVE_POKEMON',
    EVOLVE_SKIP_STAGE_1: 'EVOLVE_POKEMON',
    EVOLVE_SKIP_STAGE1: 'EVOLVE_POKEMON',
    EVOLVE_FROM_HAND: 'EVOLVE_POKEMON',
    EVOLVE_NORMAL: 'EVOLVE_POKEMON',
    EVOLVE: 'EVOLVE_POKEMON',
    SHUFFLE_HAND_DRAW: 'SHUFFLE_HAND_DRAW',
    SHUFFLE_HAND_AND_DRAW: 'SHUFFLE_HAND_DRAW',
    DISCARD_HAND_AND_DRAW: 'SHUFFLE_HAND_DRAW',
    SHUFFLE_HAND_BOTTOM_DRAW_PRIZES: 'SHUFFLE_HAND_DRAW',
    IONO_EFFECT: 'SHUFFLE_HAND_DRAW',
    RECOVER_FROM_DISCARD: 'RECOVER_FROM_DISCARD',
    RECOVER_FROM_DISCARD_TO_HAND: 'RECOVER_FROM_DISCARD',
    RECOVER_FROM_DISCARD_TO_DECK: 'RECOVER_FROM_DISCARD',
    RECOVER_FROM_DISCARD_TO_BENCH: 'RECOVER_FROM_DISCARD',
    RECOVER_DISCARD_TO_HAND: 'RECOVER_FROM_DISCARD',
    SHUFFLE_DISCARD_TO_DECK: 'RECOVER_FROM_DISCARD',
  }
  return map[s] || 'DRAW_CARDS'
}

function normalizeCard(raw) {
  const rawIdent = raw.identity || {}
  const cardId = String(raw.cardId || rawIdent.cardId || 'unknown-id').trim()
  const cat = String(raw.category || rawIdent.category || 'POKEMON').toUpperCase()
  const category = cat.includes('POK') ? 'POKEMON' : cat.includes('ENERG') ? 'ENERGY' : 'TRAINER'
  const subCategory = String(raw.subCategory || rawIdent.subCategory || 'BASIC').toUpperCase()

  const isRuleBox = Boolean(
    rawIdent.isRuleBox ?? raw.pokemonStats?.isRuleBox ?? raw.isRuleBox ?? false
  )
  let prizeCardsGiven = 1
  if (rawIdent.prizeCardsGiven != null) {
    prizeCardsGiven = Math.max(1, Math.min(3, Number(rawIdent.prizeCardsGiven)))
  } else if (raw.pokemonStats?.prizeCardsGiven != null) {
    prizeCardsGiven = Math.max(1, Math.min(3, Number(raw.pokemonStats.prizeCardsGiven)))
  } else if (isRuleBox) {
    prizeCardsGiven = 2
  }

  const regMark = rawIdent.regulationMark ? String(rawIdent.regulationMark).toUpperCase() : null
  const legalStandard = Boolean(
    rawIdent.legalStandard ?? (subCategory === 'BASIC_ENERGY' || ['G', 'H', 'I'].includes(regMark || ''))
  )

  const identity = {
    cardId,
    nameFr: String(rawIdent.nameFr || raw.nameFr || cardId),
    nameEn: rawIdent.nameEn ? String(rawIdent.nameEn) : null,
    setId: String(rawIdent.setId || raw.setId || ''),
    setName: rawIdent.setName ? String(rawIdent.setName) : null,
    category,
    subCategory,
    isRuleBox,
    prizeCardsGiven,
    isAceSpec: Boolean(rawIdent.isAceSpec ?? false),
    isAncient: Boolean(rawIdent.isAncient ?? rawIdent.mechanicTag === 'ANCIENT'),
    isFuture: Boolean(rawIdent.isFuture ?? rawIdent.mechanicTag === 'FUTURE'),
    isTera: Boolean(rawIdent.isTera ?? raw.pokemonStats?.isTera ?? false),
    legalStandard,
    legalExpanded: Boolean(rawIdent.legalExpanded ?? true),
    localId: rawIdent.localId ? String(rawIdent.localId) : null,
    regulationMark: regMark,
    rarity: rawIdent.rarity ? String(rawIdent.rarity) : null,
    imageUrl: rawIdent.imageUrl ? String(rawIdent.imageUrl) : null,
    isTechnicalMachine: Boolean(rawIdent.isTechnicalMachine ?? false),
    rawRulesText: Array.isArray(rawIdent.rawRulesText) ? rawIdent.rawRulesText.map(String) : [],
    mechanicTag: rawIdent.mechanicTag ?? (rawIdent.isAncient ? 'ANCIENT' : rawIdent.isFuture ? 'FUTURE' : null),
  }

  let pokemonStats = null
  if (category === 'POKEMON' || raw.pokemonStats) {
    const rs = raw.pokemonStats || {}
    let stage = String(rs.stage || 'Base').trim()
    if (stage.includes('2')) stage = 'Niveau 2'
    else if (stage.includes('1') || stage.toLowerCase().includes('vmax') || stage.toLowerCase().includes('vstar')) stage = 'Niveau 1'
    else stage = 'Base'

    const weaknesses = []
    if (Array.isArray(rs.weaknesses)) {
      for (const w of rs.weaknesses) {
        if (typeof w === 'string') weaknesses.push({ type: w, value: '×2' })
        else if (w && typeof w === 'object') weaknesses.push({ type: String(w.type || 'Incolore'), value: String(w.value || '×2') })
      }
    }

    const resistances = []
    if (Array.isArray(rs.resistances)) {
      for (const r of rs.resistances) {
        if (typeof r === 'string') resistances.push({ type: r, value: '-30' })
        else if (r && typeof r === 'object') resistances.push({ type: String(r.type || 'Incolore'), value: String(r.value || '-30') })
      }
    }

    pokemonStats = {
      hp: Math.max(0, Number(rs.hp || 0)),
      types: Array.isArray(rs.types) ? rs.types.map(String) : ['Incolore'],
      stage,
      evolvesFrom: rs.evolvesFrom ? String(rs.evolvesFrom) : null,
      rootBasicName: String(rs.rootBasicName || (rs.evolutionChain && rs.evolutionChain[0]) || identity.nameFr),
      evolutionChain: Array.isArray(rs.evolutionChain) ? rs.evolutionChain.map(String) : [],
      retreatCost: Math.max(0, Number(rs.retreatCost || 0)),
      weaknesses,
      resistances,
      prizeCardsGiven,
      isRuleBox,
      isTera: identity.isTera,
      isAncient: identity.isAncient,
      isFuture: identity.isFuture,
      canAttackTwice: Boolean(rs.canAttackTwice || raw.canAttackTwice),
    }
  }

  const rawActions = Array.isArray(raw.playableActions) ? raw.playableActions : []
  const playableActions = rawActions.map((ra, idx) => {
    const actionId = String(ra.actionId || ra.id || `action_${idx}`)
    let actionType = 'PLAY_FROM_HAND'
    const rawType = String(ra.actionType || ra.sourceType || '').toUpperCase()
    if (rawType.includes('ATTACK')) actionType = 'ATTACK'
    else if (rawType.includes('ABILITY') || rawType.includes('TALENT')) actionType = 'USE_ABILITY'
    else if (rawType.includes('EVOLV')) actionType = 'EVOLVE'
    else if (rawType.includes('RETREAT')) actionType = 'RETREAT'
    else if (rawType.includes('ATTACH')) actionType = 'ATTACH_ENERGY'

    const timingPhase = actionType === 'ATTACK' ? 'ATTACK_PHASE' : 'MAIN_PHASE_1'

    const cost = {}
    if (ra.cost && typeof ra.cost === 'object' && !Array.isArray(ra.cost)) {
      for (const [k, v] of Object.entries(ra.cost)) {
        const num = Number(v)
        if (!isNaN(num) && num > 0) cost[k] = num
      }
    } else if (Array.isArray(ra.energyCost)) {
      for (const item of ra.energyCost) {
        if (typeof item === 'string' && item.trim()) {
          const k = item.trim()
          cost[k] = (cost[k] || 0) + 1
        }
      }
    }

    const preconditions = []
    if (Array.isArray(ra.preconditions)) {
      for (const p of ra.preconditions) {
        if (typeof p === 'string' && p.trim()) preconditions.push(p.trim())
        else if (p && typeof p === 'object') {
          const t = String(p.type || p.condition || '').trim()
          if (t === 'HAND_MIN_OTHER_CARDS' && p.minCount != null) {
            preconditions.push(`HAND_MIN_OTHER_CARDS_${p.minCount}`)
          } else if (t) {
            preconditions.push(t)
          }
        }
      }
    }

    const extraEffects = []
    if (Array.isArray(ra.costs)) {
      for (const c of ra.costs) {
        if (c && c.type === 'DISCARD_FROM_HAND') {
          const count = Number(c.count) || 1
          const preKey = `HAND_MIN_OTHER_CARDS_${count}`
          if (!preconditions.includes(preKey)) preconditions.push(preKey)
          extraEffects.push({
            primitive: 'DISCARD_CARDS',
            target: 'PLAYER',
            count,
            zone: 'HAND',
            upTo: false,
            optional: false,
          })
        }
      }
    }

    const rawEffects = Array.isArray(ra.effects) ? ra.effects : []
    const mappedEffects = rawEffects.map((re) => {
      const primitive = coerceEffectPrimitive(re.primitive || re.type)
      const target = re.target != null ? String(re.target) : re.targetZone ? String(re.targetZone) : null
      const zone = re.zone != null ? String(re.zone) : re.sourceZone ? String(re.sourceZone) : null
      let value = null
      if (re.value != null) value = Number(re.value)
      else if (re.baseDamage != null) value = Number(re.baseDamage)
      else if (re.damage != null) value = Number(re.damage)

      let count = null
      if (re.count != null) count = Number(re.count)

      let filter = null
      if (typeof re.filter === 'string') filter = re.filter
      else if (re.targetFilter) filter = targetFilterToDsl(re.targetFilter)

      return {
        primitive,
        target,
        value: value != null && !isNaN(value) ? value : null,
        count: count != null && !isNaN(count) ? count : null,
        zone,
        filter,
        upTo: Boolean(re.upTo ?? false),
        optional: Boolean(re.optional ?? false),
        baseDamage: value,
      }
    })

    return {
      actionId,
      label: String(ra.label || ra.name || actionId),
      actionType,
      timingPhase,
      canUseTurn1GoingFirst: Boolean(ra.canUseTurn1GoingFirst ?? (actionType !== 'ATTACK' && actionType !== 'EVOLVE')),
      canUseTurn1GoingSecond: Boolean(ra.canUseTurn1GoingSecond ?? actionType !== 'EVOLVE'),
      cost,
      preconditions,
      effects: [...extraEffects, ...mappedEffects],
      deadCardCondition: typeof ra.deadCardCondition === 'string' ? ra.deadCardCondition : null,
      canAttackTwice: Boolean(ra.canAttackTwice),
    }
  })

  const rawStrat = raw.strategicEvaluator || {}
  const rawRole = String(rawStrat.aiRole || rawStrat.primaryRole || 'GUEST_TECH').toUpperCase()
  let aiRole = 'GUEST_TECH'
  if (rawRole.includes('MAIN') || rawRole.includes('ATTACK')) aiRole = 'MAIN_ATTACKER'
  else if (rawRole.includes('SECOND')) aiRole = 'SECONDARY_ATTACKER'
  else if (rawRole.includes('DRAW')) aiRole = 'DRAW_ENGINE'
  else if (rawRole.includes('ENERG')) aiRole = 'ENERGY_ACCELERATOR'
  else if (rawRole.includes('DISRUPT') || rawRole.includes('GUST') || rawRole.includes('CONTROL')) aiRole = 'DISRUPTION'
  else if (rawRole.includes('CONSIST') || rawRole.includes('TUTOR') || rawRole.includes('EVOLV')) aiRole = 'CONSISTENCY_BOOSTER'

  const rawWeights = rawStrat.turnPhaseWeights || {}
  const clampW = (v, d = 0.8) => {
    const n = Number(v)
    return isNaN(n) ? d : Math.max(0.0, Math.min(1.0, n))
  }

  const turnPhaseWeights = {
    turn1: clampW(rawWeights.turn1 ?? rawWeights.T1, 0.8),
    turn2: clampW(rawWeights.turn2 ?? rawWeights.T2, 0.8),
    turn3: clampW(rawWeights.turn3 ?? rawWeights.T3, 0.8),
    turn4Plus: clampW(rawWeights.turn4Plus ?? rawWeights.T4, 0.8),
  }

  const decklistSynergyRequirements = []
  if (Array.isArray(rawStrat.decklistSynergyRequirements)) {
    for (const syn of rawStrat.decklistSynergyRequirements) {
      if (typeof syn === 'string' && syn.trim()) decklistSynergyRequirements.push(syn.trim())
      else if (syn && typeof syn === 'object') {
        const rf = syn.requiredFilter || {}
        if (rf.energyType) decklistSynergyRequirements.push(`requires_energy_type:${rf.energyType}`)
        else if (rf.specificCardName) decklistSynergyRequirements.push(`requires_evolution_line:${rf.specificCardName}`)
        else if (rf.subCategory) decklistSynergyRequirements.push(`requires_subcategory:${rf.subCategory}`)
        else if (rf.category) decklistSynergyRequirements.push(`requires_category:${rf.category}`)
      }
    }
  }

  return {
    cardId,
    identity,
    pokemonStats,
    category,
    subCategory,
    playableActions,
    strategicEvaluator: {
      aiRole,
      turnPhaseWeights,
      decklistSynergyRequirements: Array.from(new Set(decklistSynergyRequirements)),
      primaryRole: aiRole,
    },
    compilationMetadata: raw.compilationMetadata || null,
  }
}

// 1. Charger la source principale
let cardRegistry = new Map()

if (sourcePath && fs.existsSync(sourcePath)) {
  try {
    const rawContent = fs.readFileSync(sourcePath, 'utf-8')
    const parsed = JSON.parse(rawContent)
    const cardList = Array.isArray(parsed)
      ? parsed
      : parsed && parsed.cards
      ? Object.values(parsed.cards)
      : []

    for (const rawCard of cardList) {
      const norm = normalizeCard(rawCard)
      cardRegistry.set(norm.cardId, norm)
    }
    console.log(`[syncCardDatabase] ${cardRegistry.size} carte(s) chargée(s) depuis ${sourcePath}`)
  } catch (err) {
    console.error(`[syncCardDatabase] Erreur lors du chargement de ${sourcePath}:`, err)
  }
}

// 2. Vérifier et intégrer les 11 cartes méta de référence manquantes
for (const refId of META_REFERENCE_CARD_IDS) {
  if (!cardRegistry.has(refId)) {
    let loadedCard = null
    const oldFile = oldDir ? path.join(oldDir, `${refId}.json`) : null
    const compiledFile = compiledDir ? path.join(compiledDir, `${refId}.json`) : null

    if (compiledFile && fs.existsSync(compiledFile)) {
      try {
        loadedCard = JSON.parse(fs.readFileSync(compiledFile, 'utf-8'))
      } catch (e) {
        // ignore
      }
    }
    if (!loadedCard && oldFile && fs.existsSync(oldFile)) {
      try {
        loadedCard = JSON.parse(fs.readFileSync(oldFile, 'utf-8'))
      } catch (e) {
        // ignore
      }
    }

    if (loadedCard) {
      const normalized = normalizeCard(loadedCard)
      cardRegistry.set(refId, normalized)
      console.log(`[syncCardDatabase] Carte de référence réintégrée et normalisée : ${refId} (${normalized.identity.nameFr})`)
    } else {
      console.warn(`[syncCardDatabase] Carte de référence introuvable : ${refId}`)
    }
  }
}

// 3. Écrire le fichier consolidé
const allCards = Array.from(cardRegistry.values())
fs.writeFileSync(targetPath, JSON.stringify(allCards, null, 2), 'utf-8')

console.log(
  `[syncCardDatabase] Base de cartes synchronisée avec succès (${allCards.length} carte(s)) dans ${targetPath}`,
)
