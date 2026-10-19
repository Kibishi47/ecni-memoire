import type { OpponentId, SimplifiedResult, CardItem } from '../types/pokemon-tcg'

interface SimulationEntry {
  scorePercent: number
  verdictSentence: string
  turn1ReadyPercent: number
  turn2AttackPercent: number
  brickRiskPercent: number
  failureWeights: [number, number, number] // [Manque de Base, Manque d'Énergie, Cartes clés Récompenses]
}

const PRESET_SIMULATION_DATA: Record<string, Record<OpponentId, SimulationEntry>> = {
  charizard_pidgeot: {
    goldfish: {
      scorePercent: 91,
      verdictSentence: 'Excellente régularité sans opposition. Le deck installe Roucarnage ex et Dracaufeu ex au Tour 2 presque à chaque partie.',
      turn1ReadyPercent: 92,
      turn2AttackPercent: 87,
      brickRiskPercent: 7,
      failureWeights: [45, 30, 25]
    },
    aggro_turbo: {
      scorePercent: 78,
      verdictSentence: "Votre deck tient bien la route, mais manque parfois d'un deuxième Pokémon de base au Tour 1 face à la menace de K.O. immédiat.",
      turn1ReadyPercent: 86,
      turn2AttackPercent: 78,
      brickRiskPercent: 14,
      failureWeights: [54, 22, 24]
    },
    mirror_setup: {
      scorePercent: 82,
      verdictSentence: "Bonne vitesse d'exécution, mais vous concédez parfois le premier tour d'évolution Super Bonbon à l'adversaire.",
      turn1ReadyPercent: 88,
      turn2AttackPercent: 81,
      brickRiskPercent: 10,
      failureWeights: [42, 28, 30]
    },
    disruption: {
      scorePercent: 79,
      verdictSentence: "Le deck encaisse bien la réduction de main au Tour 3 à condition d'avoir sécurisé Roucarnage ex sur le terrain.",
      turn1ReadyPercent: 87,
      turn2AttackPercent: 75,
      brickRiskPercent: 12,
      failureWeights: [38, 26, 36]
    }
  },
  raging_bolt_ogerpon: {
    goldfish: {
      scorePercent: 94,
      verdictSentence: "Vitesse maximale. L'attaque à 280 dégâts est opérationnelle dès le Tour 2 sans aucune difficulté.",
      turn1ReadyPercent: 95,
      turn2AttackPercent: 91,
      brickRiskPercent: 5,
      failureWeights: [35, 45, 20]
    },
    aggro_turbo: {
      scorePercent: 85,
      verdictSentence: "Très solide en vitesse pure. La partie bascule selon qui inflige le premier K.O. décisif.",
      turn1ReadyPercent: 91,
      turn2AttackPercent: 85,
      brickRiskPercent: 9,
      failureWeights: [32, 48, 20]
    },
    mirror_setup: {
      scorePercent: 88,
      verdictSentence: "Votre deck déborde facilement l'adversaire avant qu'il ne puisse faire évoluer ses Pokémon.",
      turn1ReadyPercent: 93,
      turn2AttackPercent: 88,
      brickRiskPercent: 7,
      failureWeights: [30, 46, 24]
    },
    disruption: {
      scorePercent: 72,
      verdictSentence: "Attention : si votre main est vidée au Tour 3, vous risquez une panne sèche d'Énergie pour réattaquer.",
      turn1ReadyPercent: 90,
      turn2AttackPercent: 74,
      brickRiskPercent: 15,
      failureWeights: [20, 62, 18]
    }
  },
  gardevoir_munkidori: {
    goldfish: {
      scorePercent: 89,
      verdictSentence: "Moteur de pioche continu très fluide. Vous installez 2 Kirlia et préparez vos énergies sereinement.",
      turn1ReadyPercent: 89,
      turn2AttackPercent: 83,
      brickRiskPercent: 8,
      failureWeights: [44, 32, 24]
    },
    aggro_turbo: {
      scorePercent: 68,
      verdictSentence: "Départ sous tension : vos petits Pokémon de base à 70 PV risquent d'être éliminés trop vite au Tour 2.",
      turn1ReadyPercent: 81,
      turn2AttackPercent: 64,
      brickRiskPercent: 18,
      failureWeights: [58, 22, 20]
    },
    mirror_setup: {
      scorePercent: 84,
      verdictSentence: "Très bon contrôle de la partie grâce à la régénération d'énergies et l'échange de cartes Récompenses.",
      turn1ReadyPercent: 86,
      turn2AttackPercent: 80,
      brickRiskPercent: 10,
      failureWeights: [40, 32, 28]
    },
    disruption: {
      scorePercent: 87,
      verdictSentence: "Résistance exemplaire : vos Kirlia sur le banc vous permettent de repiocher aussitôt après Mashynn.",
      turn1ReadyPercent: 88,
      turn2AttackPercent: 84,
      brickRiskPercent: 8,
      failureWeights: [35, 30, 35]
    }
  }
}

export function computeSimplifiedSimulation(
  deckId: string,
  deckName: string,
  opponentId: OpponentId,
  opponentName: string,
  cards: CardItem[]
): SimplifiedResult {
  const isPreset = deckId in PRESET_SIMULATION_DATA

  if (isPreset) {
    const entry = PRESET_SIMULATION_DATA[deckId][opponentId]
    return {
      deckName,
      opponentName,
      scorePercent: entry.scorePercent,
      verdictSentence: entry.verdictSentence,
      turn1ReadyPercent: entry.turn1ReadyPercent,
      turn2AttackPercent: entry.turn2AttackPercent,
      brickRiskPercent: entry.brickRiskPercent,
      failureCauses: [
        { label: 'Manque de Pokémon de base', percent: entry.failureWeights[0] },
        { label: "Manque d'Énergie", percent: entry.failureWeights[1] },
        { label: 'Cartes clés dans les Récompenses', percent: entry.failureWeights[2] }
      ]
    }
  }

  // Dynamic computation for custom pasted list
  const basicsCount = cards
    .filter(c => c.role === 'basic_pokemon')
    .reduce((sum, c) => sum + c.count, 0)
  
  const searchCount = cards
    .filter(c => c.role === 'search_engine')
    .reduce((sum, c) => sum + c.count, 0)

  const energyCount = cards
    .filter(c => c.role === 'energy')
    .reduce((sum, c) => sum + c.count, 0)

  let baseScore = 80
  if (basicsCount < 9) baseScore -= 14
  else if (basicsCount >= 12) baseScore += 5

  if (searchCount < 8) baseScore -= 10
  else if (searchCount >= 12) baseScore += 4

  if (energyCount < 7) baseScore -= 10
  else if (energyCount > 15) baseScore -= 6

  if (opponentId === 'aggro_turbo') baseScore -= 8
  if (opponentId === 'disruption') baseScore -= 6

  const scorePercent = Math.max(45, Math.min(96, baseScore))
  const turn1ReadyPercent = Math.max(50, Math.min(97, scorePercent + 6))
  const turn2AttackPercent = Math.max(40, Math.min(94, scorePercent - 4))
  const brickRiskPercent = Math.max(5, Math.min(35, 100 - scorePercent))

  let verdictSentence = "Votre deck personnalisé présente un bon équilibre général pour développer son jeu."
  if (basicsCount < 9) {
    verdictSentence = `Votre deck manque de Pokémon de base (${basicsCount} seulement), ce qui augmente le risque de départ à vide.`
  } else if (energyCount < 7) {
    verdictSentence = `Attention : seulement ${energyCount} cartes Énergie, vous risquez une panne d'attaque dès le Tour 2.`
  } else if (opponentId === 'aggro_turbo') {
    verdictSentence = "Face à un adversaire rapide, votre deck doit impérativement trouver un second Pokémon dès le Tour 1."
  }

  // Determine weight distribution
  let wBase = basicsCount < 9 ? 60 : 40
  let wEnergy = energyCount < 8 ? 40 : 30
  let wPrizes = 100 - wBase - wEnergy

  return {
    deckName,
    opponentName,
    scorePercent,
    verdictSentence,
    turn1ReadyPercent,
    turn2AttackPercent,
    brickRiskPercent,
    failureCauses: [
      { label: 'Manque de Pokémon de base', percent: wBase },
      { label: "Manque d'Énergie", percent: wEnergy },
      { label: 'Cartes clés dans les Récompenses', percent: wPrizes }
    ]
  }
}
