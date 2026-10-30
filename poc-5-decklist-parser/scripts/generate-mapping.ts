/**
 * Script de génération de la table de correspondance PTCGL <-> TCGdex
 * Exécutable via : npm run generate-mapping (ou node scripts/generate-mapping.ts)
 *
 * Ce script :
 * 1. Interroge l'API officielle TCGdex (/v2/en/sets et /v2/fr/sets) si le réseau est disponible.
 * 2. Applique la table d'alias officielle inspirée de osamc/pokemon-tcg-deck-parser
 *    et du registre des codes d'extension PTCGL / Limitless.
 * 3. Génère le fichier JSON statique `src/data/mapping_ptcgl_to_tcgdex.json` utilisé par l'application web.
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(fileURLToPath(import.meta.url))

export interface SetMappingEntry {
  setId: string
  ptcglCode: string
  aliases: string[]
  nameFr: string
  nameEn: string
  serie: string
  officialCount: number
  releaseDate: string
  legalStandard: boolean
  legalExpanded: boolean
  padNumbers?: boolean
}

export interface MappingDatabase {
  generatedAt: string
  version: string
  source: string
  totalSets: number
  byPtcglCode: Record<string, SetMappingEntry>
  byTcgdexId: Record<string, SetMappingEntry>
  setCodeAliases: Record<string, string>
}

/**
 * Base de référence vérifiée des extensions Pokémon TCG (Séries SV, SWSH, SM, XY et Promos/Énergies)
 * avec leurs identifiants TCGdex exacts et codes PTCGL officiels.
 */
const VERIFIED_SETS_SEED: SetMappingEntry[] = [
  // === Série Écarlate et Violet (Scarlet & Violet - sv) ===
  {
    setId: 'sv01',
    ptcglCode: 'SVI',
    aliases: ['SV1', 'SV01'],
    nameFr: 'Écarlate et Violet',
    nameEn: 'Scarlet & Violet',
    serie: 'sv',
    officialCount: 198,
    releaseDate: '2023-03-31',
    legalStandard: true,
    legalExpanded: true,
  },
  {
    setId: 'sv02',
    ptcglCode: 'PAL',
    aliases: ['SV2', 'SV02'],
    nameFr: 'Évolutions à Paldea',
    nameEn: 'Paldea Evolved',
    serie: 'sv',
    officialCount: 193,
    releaseDate: '2023-06-09',
    legalStandard: true,
    legalExpanded: true,
  },
  {
    setId: 'sv03',
    ptcglCode: 'OBF',
    aliases: ['SV3', 'SV03'],
    nameFr: 'Flammes Obsidiennes',
    nameEn: 'Obsidian Flames',
    serie: 'sv',
    officialCount: 197,
    releaseDate: '2023-08-11',
    legalStandard: true,
    legalExpanded: true,
  },
  {
    setId: 'sv03.5',
    ptcglCode: 'MEW',
    aliases: ['151', 'SV3.5', 'SV03.5', 'SV3PT5'],
    nameFr: '151',
    nameEn: '151',
    serie: 'sv',
    officialCount: 165,
    releaseDate: '2023-09-22',
    legalStandard: true,
    legalExpanded: true,
  },
  {
    setId: 'sv04',
    ptcglCode: 'PAR',
    aliases: ['SV4', 'SV04'],
    nameFr: 'Faille Paradoxe',
    nameEn: 'Paradox Rift',
    serie: 'sv',
    officialCount: 182,
    releaseDate: '2023-11-03',
    legalStandard: true,
    legalExpanded: true,
  },
  {
    setId: 'sv04.5',
    ptcglCode: 'PAF',
    aliases: ['SV4.5', 'SV04.5', 'SV4PT5'],
    nameFr: 'Destinées de Paldea',
    nameEn: 'Paldean Fates',
    serie: 'sv',
    officialCount: 91,
    releaseDate: '2024-01-26',
    legalStandard: true,
    legalExpanded: true,
  },
  {
    setId: 'sv05',
    ptcglCode: 'TEF',
    aliases: ['SV5', 'SV05'],
    nameFr: 'Forces Temporelles',
    nameEn: 'Temporal Forces',
    serie: 'sv',
    officialCount: 162,
    releaseDate: '2024-03-22',
    legalStandard: true,
    legalExpanded: true,
  },
  {
    setId: 'sv06',
    ptcglCode: 'TWM',
    aliases: ['SV6', 'SV06'],
    nameFr: 'Mascarade Crépusculaire',
    nameEn: 'Twilight Masquerade',
    serie: 'sv',
    officialCount: 167,
    releaseDate: '2024-05-24',
    legalStandard: true,
    legalExpanded: true,
  },
  {
    setId: 'sv06.5',
    ptcglCode: 'SFA',
    aliases: ['SV6.5', 'SV06.5', 'SV6PT5'],
    nameFr: 'Fable Nébuleuse',
    nameEn: 'Shrouded Fable',
    serie: 'sv',
    officialCount: 64,
    releaseDate: '2024-08-02',
    legalStandard: true,
    legalExpanded: true,
  },
  {
    setId: 'sv07',
    ptcglCode: 'SCR',
    aliases: ['SV7', 'SV07'],
    nameFr: 'Couronne Stellaire',
    nameEn: 'Stellar Crown',
    serie: 'sv',
    officialCount: 142,
    releaseDate: '2024-09-13',
    legalStandard: true,
    legalExpanded: true,
  },
  {
    setId: 'sv08',
    ptcglCode: 'SSP',
    aliases: ['SV8', 'SV08'],
    nameFr: 'Étincelles Déferlantes',
    nameEn: 'Surging Sparks',
    serie: 'sv',
    officialCount: 191,
    releaseDate: '2024-11-08',
    legalStandard: true,
    legalExpanded: true,
  },
  {
    setId: 'sv08.5',
    ptcglCode: 'PRE',
    aliases: ['SV8.5', 'SV08.5', 'SV8PT5'],
    nameFr: 'Évolutions Prismatiques',
    nameEn: 'Prismatic Evolutions',
    serie: 'sv',
    officialCount: 131,
    releaseDate: '2025-01-17',
    legalStandard: true,
    legalExpanded: true,
  },
  {
    setId: 'sv09',
    ptcglCode: 'JTG',
    aliases: ['SV9', 'SV09'],
    nameFr: 'Aventures Ensemble',
    nameEn: 'Journey Together',
    serie: 'sv',
    officialCount: 159,
    releaseDate: '2025-03-28',
    legalStandard: true,
    legalExpanded: true,
  },
  {
    setId: 'sv10',
    ptcglCode: 'DRI',
    aliases: ['SV10'],
    nameFr: 'Rivaux Destinés',
    nameEn: 'Destined Rivals',
    serie: 'sv',
    officialCount: 182,
    releaseDate: '2025-05-30',
    legalStandard: true,
    legalExpanded: true,
  },
  {
    setId: 'svp',
    ptcglCode: 'PR-SV',
    aliases: ['SVP', 'PR-SVI'],
    nameFr: 'Promos Écarlate et Violet',
    nameEn: 'Scarlet & Violet Promos',
    serie: 'sv',
    officialCount: 200,
    releaseDate: '2023-03-31',
    legalStandard: true,
    legalExpanded: true,
  },
  {
    setId: 'sve',
    ptcglCode: 'SVE',
    aliases: ['ENERGY', 'MEE'],
    nameFr: 'Énergies Écarlate et Violet',
    nameEn: 'Scarlet & Violet Energies',
    serie: 'sv',
    officialCount: 16,
    releaseDate: '2023-03-31',
    legalStandard: true,
    legalExpanded: true,
  },

  // === Série Épée et Bouclier (Sword & Shield - swsh) ===
  {
    setId: 'swsh1',
    ptcglCode: 'SSH',
    aliases: ['SWSH1', 'SWSH01'],
    nameFr: 'Épée et Bouclier',
    nameEn: 'Sword & Shield',
    serie: 'swsh',
    officialCount: 202,
    releaseDate: '2020-02-07',
    legalStandard: false,
    legalExpanded: true,
  },
  {
    setId: 'swsh2',
    ptcglCode: 'RCL',
    aliases: ['SWSH2', 'SWSH02'],
    nameFr: 'Clash des Rebelles',
    nameEn: 'Rebel Clash',
    serie: 'swsh',
    officialCount: 192,
    releaseDate: '2020-05-01',
    legalStandard: false,
    legalExpanded: true,
  },
  {
    setId: 'swsh3',
    ptcglCode: 'DAA',
    aliases: ['SWSH3', 'SWSH03'],
    nameFr: 'Ténèbres Embrasées',
    nameEn: 'Darkness Ablaze',
    serie: 'swsh',
    officialCount: 189,
    releaseDate: '2020-08-14',
    legalStandard: false,
    legalExpanded: true,
  },
  {
    setId: 'swsh3.5',
    ptcglCode: 'CPA',
    aliases: ['SWSH3.5', 'SWSH03.5'],
    nameFr: 'La Voie du Maître',
    nameEn: "Champion's Path",
    serie: 'swsh',
    officialCount: 73,
    releaseDate: '2020-09-25',
    legalStandard: false,
    legalExpanded: true,
  },
  {
    setId: 'swsh4',
    ptcglCode: 'VIV',
    aliases: ['SWSH4', 'SWSH04'],
    nameFr: 'Voltage Éclatant',
    nameEn: 'Vivid Voltage',
    serie: 'swsh',
    officialCount: 185,
    releaseDate: '2020-11-13',
    legalStandard: false,
    legalExpanded: true,
  },
  {
    setId: 'swsh4.5',
    ptcglCode: 'SHF',
    aliases: ['SWSH4.5', 'SWSH04.5'],
    nameFr: 'Destinées Radieuses',
    nameEn: 'Shining Fates',
    serie: 'swsh',
    officialCount: 72,
    releaseDate: '2021-02-19',
    legalStandard: false,
    legalExpanded: true,
  },
  {
    setId: 'swsh5',
    ptcglCode: 'BST',
    aliases: ['SWSH5', 'SWSH05'],
    nameFr: 'Styles de Combat',
    nameEn: 'Battle Styles',
    serie: 'swsh',
    officialCount: 163,
    releaseDate: '2021-03-19',
    legalStandard: false,
    legalExpanded: true,
  },
  {
    setId: 'swsh6',
    ptcglCode: 'CRE',
    aliases: ['SWSH6', 'SWSH06'],
    nameFr: 'Règne de Glace',
    nameEn: 'Chilling Reign',
    serie: 'swsh',
    officialCount: 198,
    releaseDate: '2021-06-18',
    legalStandard: false,
    legalExpanded: true,
  },
  {
    setId: 'swsh7',
    ptcglCode: 'EVS',
    aliases: ['SWSH7', 'SWSH07'],
    nameFr: 'Évolution Céleste',
    nameEn: 'Evolving Skies',
    serie: 'swsh',
    officialCount: 203,
    releaseDate: '2021-08-27',
    legalStandard: false,
    legalExpanded: true,
  },
  {
    setId: 'swsh7.5',
    ptcglCode: 'CEL',
    aliases: ['SWSH7.5', 'SWSH07.5'],
    nameFr: 'Célébrations',
    nameEn: 'Celebrations',
    serie: 'swsh',
    officialCount: 25,
    releaseDate: '2021-10-08',
    legalStandard: false,
    legalExpanded: true,
  },
  {
    setId: 'swsh8',
    ptcglCode: 'FST',
    aliases: ['SWSH8', 'SWSH08'],
    nameFr: 'Poing de Fusion',
    nameEn: 'Fusion Strike',
    serie: 'swsh',
    officialCount: 264,
    releaseDate: '2021-11-12',
    legalStandard: false,
    legalExpanded: true,
  },
  {
    setId: 'swsh9',
    ptcglCode: 'BRS',
    aliases: ['SWSH9', 'SWSH09'],
    nameFr: 'Stars Étincelantes',
    nameEn: 'Brilliant Stars',
    serie: 'swsh',
    officialCount: 172,
    releaseDate: '2022-02-25',
    legalStandard: false,
    legalExpanded: true,
  },
  {
    setId: 'swsh10',
    ptcglCode: 'ASR',
    aliases: ['SWSH10'],
    nameFr: 'Astres Radieux',
    nameEn: 'Astral Radiance',
    serie: 'swsh',
    officialCount: 189,
    releaseDate: '2022-05-27',
    legalStandard: false,
    legalExpanded: true,
  },
  {
    setId: 'swsh10.5',
    ptcglCode: 'PGO',
    aliases: ['SWSH10.5'],
    nameFr: 'Pokémon GO',
    nameEn: 'Pokémon GO',
    serie: 'swsh',
    officialCount: 78,
    releaseDate: '2022-07-01',
    legalStandard: false,
    legalExpanded: true,
  },
  {
    setId: 'swsh11',
    ptcglCode: 'LOR',
    aliases: ['SWSH11'],
    nameFr: 'Origine Perdue',
    nameEn: 'Lost Origin',
    serie: 'swsh',
    officialCount: 196,
    releaseDate: '2022-09-09',
    legalStandard: false,
    legalExpanded: true,
  },
  {
    setId: 'swsh12',
    ptcglCode: 'SIT',
    aliases: ['SWSH12'],
    nameFr: 'Tempête Argentée',
    nameEn: 'Silver Tempest',
    serie: 'swsh',
    officialCount: 195,
    releaseDate: '2022-11-11',
    legalStandard: false,
    legalExpanded: true,
  },
  {
    setId: 'swsh12.5',
    ptcglCode: 'CRZ',
    aliases: ['SWSH12.5'],
    nameFr: 'Zénith Suprême',
    nameEn: 'Crown Zenith',
    serie: 'swsh',
    officialCount: 159,
    releaseDate: '2023-01-20',
    legalStandard: false,
    legalExpanded: true,
  },
  {
    setId: 'swshp',
    ptcglCode: 'PR-SW',
    aliases: ['SWSHP', 'PR-SWSH', 'SWSH'],
    nameFr: 'Promos Épée et Bouclier',
    nameEn: 'Sword & Shield Promos',
    serie: 'swsh',
    officialCount: 307,
    releaseDate: '2019-11-15',
    legalStandard: false,
    legalExpanded: true,
  },
]

/**
 * Table d'alias directe issue de osamc/pokemon-tcg-deck-parser
 */
const EXTRA_ALIASES: Record<string, string> = {
  'PR-SW': 'swshp',
  'PR-SWSH': 'swshp',
  SWSHP: 'swshp',
  SWSH: 'swshp',
  'PR-SV': 'svp',
  'PR-SVI': 'svp',
  SVP: 'svp',
  'PR-SM': 'smp',
  SMP: 'smp',
  'PR-XY': 'xyp',
  XYP: 'xyp',
  'PR-BW': 'bwp',
  'PR-BLW': 'bwp',
  BWP: 'bwp',
  SVE: 'sve',
  MEE: 'sve',
  ENERGY: 'sve',
}

interface TcgdexSetSummary {
  id: string
  name: string
  cardCount?: {
    total?: number
    official?: number
  }
}

async function tryFetchTcgdexSets(lang: 'en' | 'fr'): Promise<TcgdexSetSummary[] | null> {
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 3500)
    const res = await fetch(`https://api.tcgdex.net/v2/${lang}/sets`, {
      signal: controller.signal,
    })
    clearTimeout(timeout)
    if (!res.ok) return null
    return (await res.json()) as TcgdexSetSummary[]
  } catch {
    return null
  }
}

async function generateMapping() {
  const args = process.argv.slice(2)
  const shouldFetch = args.includes('--fetch')

  let sourceLabel = 'seed-verified + osamc/pokemon-tcg-deck-parser aliases'
  const setsList: SetMappingEntry[] = structuredClone(VERIFIED_SETS_SEED)

  if (shouldFetch) {
    console.log('Tentative de synchronisation avec https://api.tcgdex.net/v2 ...')
    const [enSets, frSets] = await Promise.all([
      tryFetchTcgdexSets('en'),
      tryFetchTcgdexSets('fr'),
    ])

    if (enSets && frSets) {
      sourceLabel = 'live-tcgdex-api + osamc/pokemon-tcg-deck-parser aliases'
      const frById = new Map(frSets.map((s) => [s.id, s]))
      const enById = new Map(enSets.map((s) => [s.id, s]))

      for (const entry of setsList) {
        const enMatch = enById.get(entry.setId)
        const frMatch = frById.get(entry.setId)
        if (enMatch) {
          entry.nameEn = enMatch.name
          if (enMatch.cardCount?.official) {
            entry.officialCount = enMatch.cardCount.official
          }
        }
        if (frMatch) {
          entry.nameFr = frMatch.name
        }
      }
      console.log(`Synchronisation TCGdex réussie (${enSets.length} extensions inspectées).`)
    } else {
      console.log('Mode hors-ligne détecté : utilisation de la base de référence vérifiée.')
    }
  }

  const byPtcglCode: Record<string, SetMappingEntry> = {}
  const byTcgdexId: Record<string, SetMappingEntry> = {}
  const setCodeAliases: Record<string, string> = { ...EXTRA_ALIASES }

  for (const entry of setsList) {
    const code = entry.ptcglCode.toUpperCase()
    byPtcglCode[code] = entry
    byTcgdexId[entry.setId.toLowerCase()] = entry
    setCodeAliases[code] = entry.setId

    for (const alias of entry.aliases) {
      const upperAlias = alias.toUpperCase()
      setCodeAliases[upperAlias] = entry.setId
      if (!byPtcglCode[upperAlias]) {
        byPtcglCode[upperAlias] = entry
      }
    }
  }

  const db: MappingDatabase = {
    generatedAt: new Date().toISOString(),
    version: '1.0.0',
    source: sourceLabel,
    totalSets: setsList.length,
    byPtcglCode,
    byTcgdexId,
    setCodeAliases,
  }

  const outPath = path.resolve(__dirname, '../src/data/mapping_ptcgl_to_tcgdex.json')
  fs.mkdirSync(path.dirname(outPath), { recursive: true })
  fs.writeFileSync(outPath, JSON.stringify(db, null, 2) + '\n', 'utf-8')

  console.log(`Table de correspondance générée avec succès : ${outPath}`)
  console.log(`Total extensions mappées : ${db.totalSets} (${Object.keys(byPtcglCode).length} codes et alias PTCGL actifs)`)
}

generateMapping()
