import type {
  DeckFormat,
  DeckSectionCategory,
  ParsedDeck,
  ParsedDeckEntry,
  ParseWarning,
  SynergyAuditItem,
} from '@olydor/types'
import {
  isCardStandardLegal,
  type CardFilter,
  type EngineCardModel,
  type ResolveCardItemInput,
} from '@olydor/types'
import { inferFormat, isCardLine, isSectionLine, isTotalLine, splitCardTokens } from './lines.js'
import { detectBasicEnergy, isEnergyCardName } from './energy.js'
import { lookupSetMapping } from './ptcglSetMapping.js'
import { hasCompiledCardData, matchesCardFilter, normalizeCardNameForMatch, resolveCardModel } from './cardCatalog.js'
import { normalizeCardModel } from './cardNormalizer.js'

/**
 * Determines whether a card model counts as a HIGH-TECH (ACE SPEC) card.
 * Pokémon cards are never ACE SPEC even if their attack/ability text mentions ACE SPEC.
 */
function isModelAceSpec(model: EngineCardModel, includeNameFallback = false): boolean {
  if (model.category === 'POKEMON') return false
  if (model.identity.isAceSpec === true) return true
  const rarityUpper = (model.identity.rarity || '').toUpperCase()
  if (rarityUpper.includes('ACE SPEC') || rarityUpper.includes('HIGH-TECH')) return true
  return (
    includeNameFallback &&
    /attrape-suprême|prime catcher|tampon injuste|unfair stamp/i.test(model.identity.nameFr)
  )
}

export type CardResolverFn = (
  items: ResolveCardItemInput[],
  signal?: AbortSignal,
) => Promise<unknown>

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
        messageEn: `Unrecognized line ignored: "${trimmed}"`,
      })
      continue
    }

    if (cardLine.quantity <= 0) {
      warnings.push({
        line: lineNum,
        message: `Quantité nulle ou négative ignorée : "${trimmed}"`,
        messageEn: `Zero or negative quantity ignored: "${trimmed}"`,
      })
      continue
    }

    const split = splitCardTokens(cardLine.rest)
    const cardName = split.nameTokens.join(' ').trim()

    if (!cardName) {
      warnings.push({
        line: lineNum,
        message: `Nom de carte manquant à la ligne ${lineNum}`,
        messageEn: `Missing card name at line ${lineNum}`,
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

  const isAceSpec = isModelAceSpec(model, true)
  const isRadiant = /radieux|radiant/i.test(model.identity.nameFr)
  const isEx = Boolean(model.pokemonStats?.isRuleBox)
  const isResolved = source === 'compiled_db' || source === 'native_basic_energy'
  const unresolvedReason = isResolved
    ? undefined
    : `Modèle compilé introuvable pour "${input.rawName}" (${cardId}) dans le catalogue API`

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
  const normalizedModel = normalizeCardModel(model)
  const mapping = lookupSetMapping(normalizedModel.identity.setId)
  const cleanNumber = stripLeadingZeros(normalizedModel.identity.localId || '001')
  const paddedNumber = padLocalNumber(cleanNumber)
  const sectionCategory: DeckSectionCategory =
    normalizedModel.category === 'POKEMON'
      ? 'pokemon'
      : normalizedModel.category === 'TRAINER'
        ? 'trainer'
        : 'energy'

  return {
    uid: `${normalizedModel.cardId}_${lineIndex}_${Date.now()}`,
    quantity,
    name: normalizedModel.identity.nameFr,
    nameFr: normalizedModel.identity.nameFr,
    nameEn: normalizedModel.identity.nameEn || normalizedModel.identity.nameFr,
    setCode: mapping.ptcglCode,
    number: cleanNumber,
    paddedNumber,
    category: sectionCategory,
    upperCategory: normalizedModel.category,
    subCategory: normalizedModel.subCategory,
    setId: normalizedModel.identity.setId,
    setName: normalizedModel.identity.setName || mapping.nameFr,
    serie: mapping.serie,
    cardId: normalizedModel.cardId,
    unpaddedCardId: `${normalizedModel.identity.setId}-${cleanNumber}`,
    ptcglId: `${mapping.ptcglCode}-${cleanNumber}`,
    imageUrl:
      normalizedModel.identity.imageUrl ||
      `https://assets.tcgdex.net/fr/${mapping.serie}/${normalizedModel.identity.setId}/${paddedNumber}`,
    isAceSpec: isModelAceSpec(normalizedModel),
    isRadiant: /radieux|radiant/i.test(normalizedModel.identity.nameFr),
    isEx: Boolean(normalizedModel.pokemonStats?.isRuleBox),
    line: lineIndex,
    raw: `${quantity} ${normalizedModel.identity.nameFr} ${mapping.ptcglCode} ${cleanNumber}`,
    model: normalizedModel,
    resolvedFromSource: normalizedModel.subCategory === 'BASIC_ENERGY' ? 'native_basic_energy' : 'compiled_db',
    isResolved: true,
  }
}

function describeCardFilter(filter: CardFilter, lang: 'fr' | 'en' = 'fr'): string {
  const parts: string[] = []
  if (filter.specificCardName) {
    parts.push(lang === 'en' ? `"${filter.specificCardName}"` : `« ${filter.specificCardName} »`)
  } else if (filter.subCategory) {
    const subLabels: Record<string, { fr: string; en: string }> = {
      BASIC: { fr: 'Pokémon de Base', en: 'Basic Pokémon' },
      STAGE_1: { fr: 'Pokémon Niveau 1', en: 'Stage 1 Pokémon' },
      STAGE_2: { fr: 'Pokémon Niveau 2', en: 'Stage 2 Pokémon' },
      ITEM: { fr: 'Objet', en: 'Item' },
      SUPPORTER: { fr: 'Supporter', en: 'Supporter' },
      TOOL: { fr: 'Outil Pokémon', en: 'Pokémon Tool' },
      STADIUM: { fr: 'Stade', en: 'Stadium' },
      BASIC_ENERGY: { fr: 'Énergie de Base', en: 'Basic Energy' },
      SPECIAL_ENERGY: { fr: 'Énergie Spéciale', en: 'Special Energy' },
    }
    const label = subLabels[filter.subCategory]
    parts.push(label ? label[lang] : filter.subCategory)
  } else if (filter.category) {
    const catLabels: Record<string, { fr: string; en: string }> = {
      POKEMON: { fr: 'Pokémon', en: 'Pokémon' },
      TRAINER: { fr: 'Dresseur', en: 'Trainer' },
      ENERGY: { fr: 'Énergie', en: 'Energy' },
    }
    const label = catLabels[filter.category]
    parts.push(label ? label[lang] : filter.category)
  }
  if (filter.maxHp) {
    parts.push(lang === 'en' ? `≤ ${filter.maxHp} HP` : `≤ ${filter.maxHp} PV`)
  }
  if (filter.energyType) {
    parts.push(lang === 'en' ? `${filter.energyType} type` : `type ${filter.energyType}`)
  }
  return parts.join(' ') || (lang === 'en' ? 'matching cards' : 'cartes compatibles')
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
      const matchedCardIds: string[] = []
      const pushMatchedCardId = (cid: string) => {
        if (cid && cid !== entry.model.cardId && !matchedCardIds.includes(cid)) {
          matchedCardIds.push(cid)
        }
      }
      let filterDesc = ''
      let filterDescEn = ''
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
          filterDescEn = `${energyType} Energy`
          for (const c of activeCards) {
            const isMatchingEnergy =
              c.model.category === 'ENERGY' &&
              (c.model.pokemonStats?.types?.includes(energyType) ||
                c.nameFr.toLowerCase().includes(energyType.toLowerCase()) ||
                c.nameEn.toLowerCase().includes(energyType.toLowerCase()))
            if (isMatchingEnergy) {
              matchingCount += c.quantity
              pushMatchedCardId(c.cardId)
            }
          }
        } else if (rawReq.startsWith('requires_evolution_line:')) {
          const evoName = rawReq.replace('requires_evolution_line:', '')
          filterDesc = `Lignée ${evoName}`
          filterDescEn = `${evoName} line`
          for (const c of activeCards) {
            if (
              c.nameFr.toLowerCase().includes(evoName.toLowerCase()) ||
              c.nameEn.toLowerCase().includes(evoName.toLowerCase())
            ) {
              matchingCount += c.quantity
              pushMatchedCardId(c.cardId)
            }
          }
        } else {
          filterDesc = rawReq
          filterDescEn = rawReq
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
        filterDesc = describeCardFilter(reqObj.requiredFilter, 'fr')
        filterDescEn = describeCardFilter(reqObj.requiredFilter, 'en')
        for (const candidate of activeCards) {
          if (matchesCardFilter(candidate.model, reqObj.requiredFilter)) {
            matchingCount += candidate.quantity
            pushMatchedCardId(candidate.cardId)
          }
        }
      }

      const satisfied = matchingCount >= minCount
      const criticalZeroValue = matchingCount === 0 && isCriticalZero

      const nameEn = entry.nameEn || entry.nameFr
      auditItems.push({
        cardId: entry.model.cardId,
        cardNameFr: entry.nameFr,
        cardNameEn: nameEn,
        requirement:
          typeof rawReq === 'object'
            ? rawReq
            : { minCountInDeck: minCount, ifMissingSetValueToZero: isCriticalZero },
        matchingCountInDeck: matchingCount,
        matchedCardIds,
        satisfied,
        criticalZeroValue,
        description: `${entry.nameFr} attend ≥ ${minCount}× ${filterDesc} (trouvé : ${matchingCount})`,
        descriptionEn: `${nameEn} requires ≥ ${minCount}× ${filterDescEn} (found: ${matchingCount})`,
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
      messageEn: `Declared total (${declaredTotal}) differs from counted cards (${totalCards}).`,
    })
  }
  if (totalCards !== 60) {
    warnings.push({
      message: `Le deck contient ${totalCards} carte(s) au lieu des 60 cartes réglementaires.`,
      messageEn: `Deck contains ${totalCards} card(s) instead of the required 60 cards.`,
    })
  }
  if (basicPokemonCount === 0) {
    warnings.push({
      message: `Aucun Pokémon de Base détecté dans la liste (au moins 1 Pokémon BASIC est obligatoire).`,
      messageEn: `No Basic Pokémon detected in decklist (at least 1 Basic Pokémon is required).`,
    })
  }
  if (!isDatabaseLoaded) {
    warnings.push({
      message: `Simulation impossible : aucun modèle de carte n'a encore été chargé depuis l'API. Veuillez valider le deck pour résoudre les cartes.`,
      messageEn: `Cannot simulate: no card models loaded from the API yet. Please validate your deck first.`,
    })
  } else if (!isFullyResolved) {
    warnings.push({
      message: `Simulation impossible : ${unresolvedCount} carte(s) (${unresolvedCards.length} référence(s)) de votre deck n'ont pas été trouvées dans le catalogue API.`,
      messageEn: `Cannot simulate: ${unresolvedCount} card(s) (${unresolvedCards.length} reference(s)) in your deck were not found in the API catalog.`,
    })
  }

  // Règle stricte ACE SPEC : au maximum 1 seule carte ACE SPEC autorisée par deck
  const aceSpecCount = activeCards
    .filter((c) => c.isAceSpec || isModelAceSpec(c.model))
    .reduce((sum, c) => sum + c.quantity, 0)

  if (aceSpecCount > 1) {
    warnings.push({
      message: `Le deck contient ${aceSpecCount} cartes HIGH-TECH (ACE SPEC). Une seule carte HIGH-TECH est autorisée par deck.`,
      messageEn: `Deck contains ${aceSpecCount} ACE SPEC cards. Only 1 ACE SPEC card is allowed per deck.`,
    })
  }

  // Règle stricte Pokémon Radieux : au maximum 1 seul Pokémon Radieux par deck
  const radiantCount = activeCards
    .filter((c) => c.isRadiant)
    .reduce((sum, c) => sum + c.quantity, 0)

  if (radiantCount > 1) {
    warnings.push({
      message: `Le deck contient ${radiantCount} Pokémon Radieux. Un seul Pokémon Radieux est autorisé par deck.`,
      messageEn: `Deck contains ${radiantCount} Radiant Pokémon. Only 1 Radiant Pokémon is allowed per deck.`,
    })
  }

  // Règle des 4 exemplaires maximum par nom exact (hors Énergies de base)
  const copyCountByName = new Map<string, { displayName: string; count: number }>()
  for (const c of activeCards) {
    if (c.upperCategory === 'ENERGY' && c.subCategory === 'BASIC_ENERGY') continue
    const key = normalizeCardNameForMatch(c.nameFr || c.nameEn || c.name)
    if (!key) continue
    const prev = copyCountByName.get(key)
    if (prev) {
      prev.count += c.quantity
    } else {
      copyCountByName.set(key, { displayName: c.nameFr || c.name, count: c.quantity })
    }
  }
  const copyLimitViolations: string[] = []
  for (const entry of copyCountByName.values()) {
    if (entry.count > 4) {
      copyLimitViolations.push(entry.displayName)
      warnings.push({
        message: `La carte "${entry.displayName}" apparaît en ${entry.count} exemplaires (maximum réglementaire : 4 par nom).`,
        messageEn: `Card "${entry.displayName}" appears ${entry.count} times (Standard rule maximum: 4 copies per name).`,
      })
    }
  }

  // Validation de légalité Standard (marques de régulation G, H, I ou Énergies de base)
  const illegalStandardCards = activeCards.filter((c) => !isCardStandardLegal(c.model))
  if (illegalStandardCards.length > 0) {
    const illegalCount = illegalStandardCards.reduce((sum, c) => sum + c.quantity, 0)
    warnings.push({
      message: `Le deck contient ${illegalCount} carte(s) non légales au format Standard (seules les marques de régulation G, H, I et les Énergies de base sont autorisées).`,
      messageEn: `Deck contains ${illegalCount} card(s) not legal in Standard format (only regulation marks G, H, I and Basic Energies are allowed).`,
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
      radiantCount <= 1 &&
      copyLimitViolations.length === 0 &&
      isStandardLegal,
    hasAtLeastOneBasic: basicPokemonCount >= 1,
    isFullyResolved,
    isDatabaseLoaded,
    unresolvedCount,
    unresolvedCards,
    warnings,
    synergyAudit,
    aceSpecCount,
    radiantCount,
    copyLimitViolations,
    isStandardLegal,
  }
}

/**
 * Extrait les entrées non encore résolues d'un deck parsé pour les envoyer vers `POST /api/cards/resolve`.
 */
export function extractUnresolvedResolveItems(parsedDeck: ParsedDeck): ResolveCardItemInput[] {
  const byKey = new Map<string, ResolveCardItemInput>()
  for (const entry of parsedDeck.unresolvedCards) {
    const key = entry.cardId
    if (byKey.has(key)) continue
    const lastDash = entry.cardId.lastIndexOf('-')
    const normalizedSetId =
      lastDash > 0 ? entry.cardId.slice(0, lastDash) : entry.setCode.trim().toLowerCase()
    const rawSetLower = entry.setCode.trim().toLowerCase()
    const padded = padLocalNumber(entry.number)
    const stripped = stripLeadingZeros(entry.number)
    const candidateIds = Array.from(
      new Set([
        entry.cardId,
        `${normalizedSetId}-${stripped}`,
        `${normalizedSetId}-${padded}`,
        ...(rawSetLower ? [`${rawSetLower}-${stripped}`, `${rawSetLower}-${padded}`] : []),
      ]),
    )
    byKey.set(key, {
      key,
      candidateIds,
      ...(entry.name ? { name: entry.name } : {}),
    })
  }
  return Array.from(byKey.values())
}

/**
 * Version asynchrone de `parsePtcglDecklist` qui résout d'abord les cartes inconnues
 * via un résolveur externe (ex. `POST /api/cards/resolve`), hydrate le registre local puis recalcule le deck complet.
 */
export async function parsePtcglDecklistWithApi(
  text: string,
  resolverOrSignal?: CardResolverFn | AbortSignal,
  maybeSignal?: AbortSignal,
): Promise<ParsedDeck> {
  const resolver = typeof resolverOrSignal === 'function' ? resolverOrSignal : undefined
  const signal = typeof resolverOrSignal === 'function' ? maybeSignal : resolverOrSignal
  const initialParsed = parsePtcglDecklist(text)
  if (!text.trim() || initialParsed.unresolvedCards.length === 0 || !resolver) {
    return initialParsed
  }
  const items = extractUnresolvedResolveItems(initialParsed)
  if (items.length === 0) {
    return initialParsed
  }
  await resolver(items, signal)
  return parsePtcglDecklist(text)
}

/**
 * Encode une liste PTCGL en chaîne URL-safe base64url (compatible Node.js et navigateur).
 */
export function encodeDeckForUrl(ptcglText: string): string {
  const bytes = new TextEncoder().encode(ptcglText)
  let binary = ''
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]!)
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

/**
 * Décode une liste PTCGL depuis un paramètre d'URL `?deck=...`.
 */
export function decodeDeckFromUrl(encoded: string): string {
  const trimmed = encoded.trim()
  if (!trimmed) return ''
  const base64 = trimmed.replace(/-/g, '+').replace(/_/g, '/')
  const padLen = (4 - (base64.length % 4)) % 4
  const padded = base64 + '='.repeat(padLen)
  const binary = atob(padded)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return new TextDecoder().decode(bytes)
}
