import { describe, expect, it } from 'vitest'
import { getAllCatalogModels } from '../data/cardCatalog'
import type { EngineCardModel } from '../types/cardModel'
import {
  compareAttackersSideBySide,
  extractAttackerComparisonRow,
  findAlternativesForCard,
  findSmartDeckAlternatives,
} from './alternativesFinder'

describe('AlternativesFinder — Supporter-to-Item Action Economy & Attacker Comparator', () => {
  it('suggests Item and Ability alternatives for Supporters with Action Economy explanation', () => {
    const catalog = getAllCatalogModels()
    const pepper = catalog.find((c) => c.cardId === 'sv01-166')
    expect(pepper).toBeDefined()

    const suggestions = findAlternativesForCard(pepper!, catalog)
    expect(suggestions.length).toBeGreaterThan(0)

    const economyMatches = suggestions.filter(
      (s) => s.suggestionType === 'SUPPORTER_TO_ITEM_OR_ABILITY',
    )
    expect(economyMatches.length).toBeGreaterThan(0)
    expect(economyMatches[0]!.strategicReason).toContain(
      "Gain d'Économie d'Action : Passer cet effet de Supporter vers Objet/Talent libère votre Supporter du tour",
    )

    // Vérifie qu'Ordres du Boss (GUST_OPPONENT_BENCH) trouve Attrape-Riposte (sv04-160, ITEM)
    const bossOrdersMock: EngineCardModel = {
      ...pepper!,
      cardId: 'sv02-172',
      identity: {
        ...pepper!.identity,
        cardId: 'sv02-172',
        nameFr: 'Ordres du Boss',
        subCategory: 'SUPPORTER',
      },
      subCategory: 'SUPPORTER',
      playableActions: [
        {
          actionId: 'play_boss_orders',
          label: 'Ordres du Boss',
          actionType: 'PLAY_FROM_HAND',
          timingPhase: 'MAIN_PHASE_1',
          canUseTurn1GoingFirst: false,
          canUseTurn1GoingSecond: true,
          cost: {},
          preconditions: [],
          effects: [
            {
              primitive: 'SWITCH_ACTIVE',
              sourceZone: 'OPPONENT_BENCH',
              targetZone: 'OPPONENT_ACTIVE',
              target: 'ACTIVE',
              count: 1,
              upTo: false,
            },
          ],
        },
      ],
    }

    const bossAlts = findAlternativesForCard(bossOrdersMock, catalog)
    const counterCatcherHit = bossAlts.find((a) => a.alternativeCardId === 'sv04-160')
    expect(counterCatcherHit).toBeDefined()
    expect(counterCatcherHit!.suggestionType).toBe('SUPPORTER_TO_ITEM_OR_ABILITY')
  })

  it('compares alternative attackers side-by-side (HP, Energy Cost, Base/Max Damage, Retreat, Double Attack)', () => {
    const catalog = getAllCatalogModels()
    const ragingBolt = catalog.find((c) => c.cardId === 'sv05-123')!
    const charizard = catalog.find((c) => c.cardId === 'sv03-125')!

    const comparison = compareAttackersSideBySide(ragingBolt, charizard)
    expect(comparison).not.toBeNull()
    expect(comparison!.attackerA.hp).toBe(240)
    expect(comparison!.attackerB.hp).toBe(330)
    expect(comparison!.attackerA.estimatedMaxDamage).toBeGreaterThanOrEqual(70)
    expect(comparison!.attackerB.estimatedMaxDamage).toBeGreaterThanOrEqual(180)

    // Test Pomdramour vs Poissoroy (Double attaque Fête Battante)
    const dipplinMock: EngineCardModel = {
      ...ragingBolt,
      cardId: 'sv06-018',
      subCategory: 'STAGE_1',
      identity: {
        ...ragingBolt.identity,
        cardId: 'sv06-018',
        nameFr: 'Pomdramour',
        subCategory: 'STAGE_1',
      },
      pokemonStats: {
        ...ragingBolt.pokemonStats!,
        hp: 80,
        types: ['Plante'],
        retreatCost: 2,
        prizeCardsGiven: 1,
        isRuleBox: false,
        canAttackTwice: true,
      },
      playableActions: [
        {
          actionId: 'attack_festival_roulette',
          label: 'Ronde de la Fête',
          actionType: 'ATTACK',
          timingPhase: 'ATTACK_PHASE',
          canUseTurn1GoingFirst: false,
          canUseTurn1GoingSecond: true,
          canAttackTwice: true,
          cost: { Plante: 1 },
          preconditions: [],
          effects: [
            {
              primitive: 'DAMAGE_ACTIVE',
              count: 1,
              upTo: false,
              baseDamage: 20,
              value: 20,
              damageScalingType: 'PER_BENCHED_POKEMON',
              damageScalingValue: 20,
            },
          ],
        },
      ],
    }

    const row = extractAttackerComparisonRow(dipplinMock)
    expect(row).not.toBeNull()
    expect(row!.canAttackTwice).toBe(true)
    expect(row!.energyCostCount).toBe(1)

    const deckMap = findSmartDeckAlternatives([pepperOrBolt(catalog)], catalog)
    expect(Object.keys(deckMap).length).toBe(1)
  })
})

function pepperOrBolt(catalog: EngineCardModel[]): EngineCardModel {
  return catalog.find((c) => c.cardId === 'sv05-123')!
}
