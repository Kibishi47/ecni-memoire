import type {
  DeckFormat,
  DeckSectionCategory,
  ParsedDeck,
  ParsedDeckEntry,
  ParseWarning,
  SynergyAuditItem,
} from '../types/deck'
import { isCardStandardLegal, type CardFilter, type EngineCardModel } from '../types/cardModel'
import { inferFormat, isCardLine, isSectionLine, isTotalLine, splitCardTokens } from './lines'
import { detectBasicEnergy, isEnergyCardName } from './energy'
import { lookupSetMapping } from '../data/ptcglSetMapping'
import { hasCompiledCardData, matchesCardFilter, resolveCardModel } from '../data/cardCatalog'

export function padLocalNumber(rawNumber: string): string {
  const trimmed = rawNumber.trim()
  if (!/^\d+$/.test(trimmed)) return trimmed
  return String(parseInt(trimmed, 10)).padStart(3, '0')
}

export function stripLeadingZeros(rawNumber: string): string {
  const trimmed = rawNumber.trim()
  if (/^\d+$/.test(trimmed)) return String(parseInt(trimmed, 10))
  return trimmed
}

export function parsePtcglDecklist(text: string): ParsedDeck {
  const rawLines = text.split(/\r?\n/)
  const cards: ParsedDeckEntry[] = []
  const warnings: ParseWarning[] = []
  const format = inferFormat(text)

  let currentCategory: DeckSectionCategory = 'pokemon'
  let declaredTotal: number | undefined

  for (let i = 0; i < rawLines.length; i++) {
    const lineNum = i + 1
    const rawLine = rawLines[i] ?? ''
    const trimmed = rawLine.trim()

    if (!trimmed) continue
    if (trimmed.startsWith('#') || trimmed.startsWith('//')) continue

    const section = isSectionLine(trimmed)
    if (section) {
      currentCategory = section.category
      continue
    }

    const total = isTotalLine(trimmed)
    if (total !== undefined) {
      declaredTotal = total
      continue
    }

    const cardLine = isCardLine(trimmed)
    if (!cardLine) {
      warnings.push({
        line: lineNum,
        message: `Ligne non reconnue ignorée : "${trimmed}"`,
      })
      continue
    }

    if (cardLine.quantity <= 0) {
      warnings.push({
        line: lineNum,
        message: `Quantité nulle ou négative ignorée : "${trimmed}"`,
      })
      continue
    }

    const split = splitCardTokens(cardLine.rest)
    const cardName = split.nameTokens.join(' ').trim()

    if (!cardName) {
      warnings.push({
        line: lineNum,
        message: `Nom de carte manquant à la ligne ${lineNum}`,
      })
      continue
    }

    const entry = buildDeckEntryFromTokens({
      quantity: cardLine.quantity,
      rawName: cardName,
      setCode: split.setCode,
      number: split.number,
      foil: split.foil,
      categoryHint: currentCategory,
      line: lineNum,
      rawLine: trimmed,
    })

    cards.push(entry)
  }

  return computeDeckSummary(cards, format, warnings, declaredTotal)
}

export function buildDeckEntryFromTokens(input: {
  quantity: number
  rawName: string
  setCode?: string
  number?: string
  foil?: string
  categoryHint?: DeckSectionCategory
  line: number
  rawLine: string
}): ParsedDeckEntry {
  let setCode = input.setCode?.toUpperCase() || 'SVI'
  let rawNumber = input.number || '1'

  const basicEnergy = detectBasicEnergy(input.rawName, rawNumber)
  if (basicEnergy && (!input.setCode || /^energy$/i.test(input.setCode) || setCode === 'SVE')) {
    setCode = 'SVE'
    if (!input.number || parseInt(rawNumber, 10) > 16) {
      rawNumber = basicEnergy.sveNumber
    }
  }

  const mapping = lookupSetMapping(setCode)
  const setId = mapping.setId
  const serie = mapping.serie
  const setName = mapping.nameFr

  const cleanNumber = stripLeadingZeros(rawNumber)
  const paddedNumber = padLocalNumber(cleanNumber)

  const cardId = `${setId}-${paddedNumber}`
  const unpaddedCardId = `${setId}-${cleanNumber}`
  const ptcglId = `${mapping.ptcglCode}-${cleanNumber}`
  const imageUrl = `https://assets.tcgdex.net/fr/${serie}/${setId}/${paddedNumber}`

  let categoryHint: DeckSectionCategory = input.categoryHint || 'pokemon'
  if (basicEnergy || isEnergyCardName(input.rawName) || setCode === 'SVE') {
    categoryHint = 'energy'
  }

  const { model, source } = resolveCardModel({
    cardId,
    unpaddedCardId,
    rawName: input.rawName,
    categoryHint,
    setId,
    setName,
    localId: paddedNumber,
    imageUrl,
  })

  const sectionCategory: DeckSectionCategory =
    model.category === 'POKEMON' ? 'pokemon' : model.category === 'TRAINER' ? 'trainer' : 'energy'

  const isAceSpec =
    model.identity.isAceSpec === true ||
    (model.identity.rarity || '').toUpperCase().includes('ACE SPEC') ||
    (model.identity.rarity || '').toUpperCase().includes('HIGH-TECH') ||
    /attrape-suprême|prime catcher|tampon injuste|unfair stamp/i.test(model.identity.nameFr)
  const isRadiant = /radieux|radiant/i.test(model.identity.nameFr)
  const isEx = Boolean(model.pokemonStats?.isRuleBox)
  const isResolved = source === 'compiled_db' || source === 'native_basic_energy'
  const unresolvedReason = isResolved
    ? undefined
    : `Modèle compilé introuvable pour "${input.rawName}" (${cardId}) dans cards_database.json`

  return {
    uid: `${cardId}_${input.line}`,
    quantity: input.quantity,
    name: input.rawName,
    nameFr: model.identity.nameFr,
    nameEn: model.identity.nameEn || model.identity.nameFr,
    setCode: mapping.ptcglCode,
    number: cleanNumber,
    paddedNumber,
    foil: input.foil,
    category: sectionCategory,
    upperCategory: model.category,
    subCategory: model.subCategory,
    setId,
    setName,
    serie,
    cardId: model.cardId,
    unpaddedCardId,
    ptcglId,
    imageUrl: model.identity.imageUrl || imageUrl,
    isAceSpec,
    isRadiant,
    isEx,
    line: input.line,
    raw: input.rawLine,
    model,
    resolvedFromSource: source,
    isResolved,
    unresolvedReason,
  }
}

export function buildDeckEntryFromModel(model: EngineCardModel, quantity: number, lineIndex = 99): ParsedDeckEntry {
  const mapping = lookupSetMapping(model.identity.setId)
  const cleanNumber = stripLeadingZeros(model.identity.localId || '001')
  const paddedNumber = padLocalNumber(cleanNumber)
  const sectionCategory: DeckSectionCategory =
    model.category === 'POKEMON' ? 'pokemon' : model.category === 'TRAINER' ? 'trainer' : 'energy'

  return {
    uid: `${model.cardId}_${lineIndex}_${Date.now()}`,
    quantity,
    name: model.identity.nameFr,
    nameFr: model.identity.nameFr,
    nameEn: model.identity.nameEn || model.identity.nameFr,
    setCode: mapping.ptcglCode,
    number: cleanNumber,
    paddedNumber,
    category: sectionCategory,
    upperCategory: model.category,
    subCategory: model.subCategory,
    setId: model.identity.setId,
    setName: model.identity.setName || mapping.nameFr,
    serie: mapping.serie,
    cardId: model.cardId,
    unpaddedCardId: `${model.identity.setId}-${cleanNumber}`,
    ptcglId: `${mapping.ptcglCode}-${cleanNumber}`,
    imageUrl: model.identity.imageUrl || `https://assets.tcgdex.net/fr/${mapping.serie}/${model.identity.setId}/${paddedNumber}`,
    isAceSpec:
      model.identity.isAceSpec === true ||
      (model.identity.rarity || '').toUpperCase().includes('ACE SPEC') ||
      (model.identity.rarity || '').toUpperCase().includes('HIGH-TECH'),
    isRadiant: /radieux|radiant/i.test(model.identity.nameFr),
    isEx: Boolean(model.pokemonStats?.isRuleBox),
    line: lineIndex,
    raw: `${quantity} ${model.identity.nameFr} ${mapping.ptcglCode} ${cleanNumber}`,
    model: structuredClone(model),
    resolvedFromSource: model.subCategory === 'BASIC_ENERGY' ? 'native_basic_energy' : 'compiled_db',
    isResolved: true,
  }
}

function describeCardFilterFr(filter: CardFilter): string {
  const parts: string[] = []
  if (filter.specificCardName) {
    parts.push(`« ${filter.specificCardName} »`)
  } else if (filter.subCategory) {
    const subLabels: Record<string, string> = {
      BASIC: 'Pokémon de Base',
      STAGE_1: 'Pokémon Niveau 1',
      STAGE_2: 'Pokémon Niveau 2',
      ITEM: 'Objet',
      SUPPORTER: 'Supporter',
      TOOL: 'Outil Pokémon',
      STADIUM: 'Stade',
      BASIC_ENERGY: 'Énergie de Base',
      SPECIAL_ENERGY: 'Énergie Spéciale',
    }
    parts.push(subLabels[filter.subCategory] || filter.subCategory)
  } else if (filter.category) {
    const catLabels: Record<string, string> = {
      POKEMON: 'Pokémon',
      TRAINER: 'Dresseur',
      ENERGY: 'Énergie',
    }
    parts.push(catLabels[filter.category] || filter.category)
  }
  if (filter.maxHp) {
    parts.push(`≤ ${filter.maxHp} PV`)
  }
  if (filter.energyType) {
    parts.push(`type ${filter.energyType}`)
  }
  return parts.join(' ') || 'cartes compatibles'
}

export function computeDeckSynergyAudit(activeCards: ParsedDeckEntry[]): SynergyAuditItem[] {
  const auditItems: SynergyAuditItem[] = []
  const seenKey = new Set<string>()

  for (const entry of activeCards) {
    const reqs = entry.model.strategicEvaluator.decklistSynergyRequirements || []
    for (let rIdx = 0; rIdx < reqs.length; rIdx++) {
      const rawReq = reqs[rIdx]!
      const key = `${entry.model.cardId}_${rIdx}`
      if (seenKey.has(key)) continue
      seenKey.add(key)

      let matchingCount = 0
      let filterDesc = ''
      let minCount = 1
      let isCriticalZero = false

      if (typeof rawReq === 'string') {
        if (rawReq.startsWith('requires_energy_type:')) {
          const energyType = rawReq.replace('requires_energy_type:', '').trim()
          const normType = energyType.toLowerCase()
          // L'audit des synergies ne doit pas analyser les energies incolores car toute energie convient
          if (normType === 'incolore' || normType === 'colorless') {
            continue
          }
          filterDesc = `Énergie ${energyType}`
          matchingCount = activeCards
            .filter(
              (c) =>
                c.model.category === 'ENERGY' &&
                (c.model.pokemonStats?.types?.includes(energyType) ||
                  c.nameFr.toLowerCase().includes(energyType.toLowerCase()) ||
                  c.nameEn.toLowerCase().includes(energyType.toLowerCase())),
            )
            .reduce((sum, c) => sum + c.quantity, 0)
        } else if (rawReq.startsWith('requires_evolution_line:')) {
          const evoName = rawReq.replace('requires_evolution_line:', '')
          filterDesc = `Lignée ${evoName}`
          matchingCount = activeCards
            .filter(
              (c) =>
                c.nameFr.toLowerCase().includes(evoName.toLowerCase()) ||
                c.nameEn.toLowerCase().includes(evoName.toLowerCase()),
            )
            .reduce((sum, c) => sum + c.quantity, 0)
        } else {
          filterDesc = rawReq
          matchingCount = 1
        }
      } else {
        const reqObj = rawReq as any
        const reqEnergyType = reqObj.requiredFilter?.energyType?.trim()?.toLowerCase()
        if (reqEnergyType === 'incolore' || reqEnergyType === 'colorless') {
          continue
        }
        minCount = reqObj.minCountInDeck || 1
        isCriticalZero = reqObj.ifMissingSetValueToZero || false
        filterDesc = describeCardFilterFr(reqObj.requiredFilter)
        for (const candidate of activeCards) {
          if (matchesCardFilter(candidate.model, reqObj.requiredFilter)) {
            matchingCount += candidate.quantity
          }
        }
      }

      const satisfied = matchingCount >= minCount
      const criticalZeroValue = matchingCount === 0 && isCriticalZero

      auditItems.push({
        cardId: entry.model.cardId,
        cardNameFr: entry.nameFr,
        requirement:
          typeof rawReq === 'object'
            ? rawReq
            : { minCountInDeck: minCount, ifMissingSetValueToZero: isCriticalZero },
        matchingCountInDeck: matchingCount,
        satisfied,
        criticalZeroValue,
        description: `${entry.nameFr} attend ≥ ${minCount}× ${filterDesc} (trouvé : ${matchingCount})`,
      })
    }
  }

  return auditItems
}

export function computeDeckSummary(
  cards: ParsedDeckEntry[],
  format: DeckFormat = 'ptcgl',
  baseWarnings: ParseWarning[] = [],
  declaredTotal?: number,
): ParsedDeck {
  const activeCards = cards.filter((c) => c.quantity > 0)

  const pokemonCount = activeCards
    .filter((c) => c.category === 'pokemon')
    .reduce((sum, c) => sum + c.quantity, 0)

  const trainerCount = activeCards
    .filter((c) => c.category === 'trainer')
    .reduce((sum, c) => sum + c.quantity, 0)

  const energyCount = activeCards
    .filter((c) => c.category === 'energy')
    .reduce((sum, c) => sum + c.quantity, 0)

  const basicPokemonCount = activeCards
    .filter((c) => c.upperCategory === 'POKEMON' && c.subCategory === 'BASIC')
    .reduce((sum, c) => sum + c.quantity, 0)

  const totalCards = pokemonCount + trainerCount + energyCount
  const uniqueIds = new Set(activeCards.map((c) => c.cardId))
  const isDatabaseLoaded = hasCompiledCardData()
  const unresolvedCards = activeCards.filter((c) => !c.isResolved)
  const unresolvedCount = unresolvedCards.reduce((sum, c) => sum + c.quantity, 0)
  const isFullyResolved = isDatabaseLoaded && unresolvedCount === 0

  const warnings = [...baseWarnings]
  if (declaredTotal !== undefined && declaredTotal !== totalCards && baseWarnings.length === 0) {
    warnings.push({
      message: `Le total déclaré (${declaredTotal}) diffère du nombre réel de cartes comptées (${totalCards}).`,
    })
  }
  if (totalCards !== 60) {
    warnings.push({
      message: `Le deck contient ${totalCards} carte(s) au lieu des 60 cartes réglementaires.`,
    })
  }
  if (basicPokemonCount === 0) {
    warnings.push({
      message: `Aucun Pokémon de Base détecté dans la liste (au moins 1 Pokémon BASIC est obligatoire).`,
    })
  }
  if (!isDatabaseLoaded) {
    warnings.push({
      message: `Simulation impossible : la base de données cards_database.json ne contient aucune carte compilée. Synchronisez les modèles de cartes pour autoriser le lancement.`,
    })
  } else if (!isFullyResolved) {
    warnings.push({
      message: `Simulation impossible : ${unresolvedCount} carte(s) (${unresolvedCards.length} référence(s)) de votre deck n'ont pas été trouvées dans la base de données cards_database.json.`,
    })
  }

  // Règle stricte ACE SPEC : au maximum 1 seule carte ACE SPEC autorisée par deck
  const aceSpecCount = activeCards
    .filter((c) => c.isAceSpec || c.model.identity.isAceSpec)
    .reduce((sum, c) => sum + c.quantity, 0)

  if (aceSpecCount > 1) {
    warnings.push({
      message: `Le deck contient ${aceSpecCount} cartes HIGH-TECH (ACE SPEC). Une seule carte HIGH-TECH est autorisée par deck.`,
    })
  }

  // Validation de légalité Standard (marques de régulation G, H, I ou Énergies de base)
  const illegalStandardCards = activeCards.filter((c) => !isCardStandardLegal(c.model))
  if (illegalStandardCards.length > 0) {
    const illegalCount = illegalStandardCards.reduce((sum, c) => sum + c.quantity, 0)
    warnings.push({
      message: `Le deck contient ${illegalCount} carte(s) non légales au format Standard (seules les marques de régulation G, H, I et les Énergies de base sont autorisées).`,
    })
  }

  const isStandardLegal = illegalStandardCards.length === 0
  const synergyAudit = computeDeckSynergyAudit(activeCards)

  return {
    format,
    cards: activeCards,
    totalCards,
    pokemonCount,
    trainerCount,
    energyCount,
    basicPokemonCount,
    uniqueCardCount: uniqueIds.size,
    isValid60:
      totalCards === 60 &&
      basicPokemonCount >= 1 &&
      isFullyResolved &&
      aceSpecCount <= 1 &&
      isStandardLegal,
    hasAtLeastOneBasic: basicPokemonCount >= 1,
    isFullyResolved,
    isDatabaseLoaded,
    unresolvedCount,
    unresolvedCards,
    warnings,
    synergyAudit,
    aceSpecCount,
    isStandardLegal,
  }
}
