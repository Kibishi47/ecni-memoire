/**
 * Base de correspondance PTCGL <-> TCGdex reprise intégralement de `poc-5-decklist-parser`.
 */

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
}

export const VERIFIED_SETS: SetMappingEntry[] = [
  { setId: 'me01', ptcglCode: 'MEG', aliases: ['ME01', 'ME1'], nameFr: 'Méga-Évolution', nameEn: 'Mega Evolution', serie: 'me', officialCount: 132, releaseDate: '2025-09-26', legalStandard: true, legalExpanded: true },
  { setId: 'me02', ptcglCode: 'PFL', aliases: ['PFF', 'ME02', 'ME2'], nameFr: 'Flammes Fantasmagoriques', nameEn: 'Phantasmal Flames', serie: 'me', officialCount: 94, releaseDate: '2025-11-28', legalStandard: true, legalExpanded: true },
  { setId: 'me02.5', ptcglCode: 'ASC', aliases: ['HER', 'ME02.5', 'ME2.5'], nameFr: 'Héros Transcendants', nameEn: 'Ascended Heroes', serie: 'me', officialCount: 217, releaseDate: '2026-01-30', legalStandard: true, legalExpanded: true },
  { setId: 'me03', ptcglCode: 'POR', aliases: ['ORP', 'ME03', 'ME3'], nameFr: 'Équilibre Parfait', nameEn: 'Perfect Order', serie: 'me', officialCount: 88, releaseDate: '2026-03-27', legalStandard: true, legalExpanded: true },
  { setId: 'me04', ptcglCode: 'CRI', aliases: ['CHA', 'ME04', 'ME4'], nameFr: 'Chaos Ascendant', nameEn: 'Chaos Rising', serie: 'me', officialCount: 86, releaseDate: '2026-05-29', legalStandard: true, legalExpanded: true },
  { setId: 'me05', ptcglCode: 'PBL', aliases: ['DKN', 'PIT', 'ME05', 'ME5'], nameFr: 'Nuit Noire', nameEn: 'Pitch Black', serie: 'me', officialCount: 84, releaseDate: '2026-07-31', legalStandard: true, legalExpanded: true },
  { setId: 'sv01', ptcglCode: 'SVI', aliases: ['SV1', 'SV01'], nameFr: 'Écarlate et Violet', nameEn: 'Scarlet & Violet', serie: 'sv', officialCount: 198, releaseDate: '2023-03-31', legalStandard: true, legalExpanded: true },
  { setId: 'sv02', ptcglCode: 'PAL', aliases: ['SV2', 'SV02'], nameFr: 'Évolutions à Paldea', nameEn: 'Paldea Evolved', serie: 'sv', officialCount: 193, releaseDate: '2023-06-09', legalStandard: true, legalExpanded: true },
  { setId: 'sv03', ptcglCode: 'OBF', aliases: ['SV3', 'SV03'], nameFr: 'Flammes Obsidiennes', nameEn: 'Obsidian Flames', serie: 'sv', officialCount: 197, releaseDate: '2023-08-11', legalStandard: true, legalExpanded: true },
  { setId: 'sv03.5', ptcglCode: 'MEW', aliases: ['151', 'SV3.5', 'SV03.5'], nameFr: '151', nameEn: '151', serie: 'sv', officialCount: 165, releaseDate: '2023-09-22', legalStandard: true, legalExpanded: true },
  { setId: 'sv04', ptcglCode: 'PAR', aliases: ['SV4', 'SV04'], nameFr: 'Faille Paradoxe', nameEn: 'Paradox Rift', serie: 'sv', officialCount: 182, releaseDate: '2023-11-03', legalStandard: true, legalExpanded: true },
  { setId: 'sv04.5', ptcglCode: 'PAF', aliases: ['SV4.5', 'SV04.5'], nameFr: 'Destinées de Paldea', nameEn: 'Paldean Fates', serie: 'sv', officialCount: 91, releaseDate: '2024-01-26', legalStandard: true, legalExpanded: true },
  { setId: 'sv05', ptcglCode: 'TEF', aliases: ['SV5', 'SV05'], nameFr: 'Forces Temporelles', nameEn: 'Temporal Forces', serie: 'sv', officialCount: 162, releaseDate: '2024-03-22', legalStandard: true, legalExpanded: true },
  { setId: 'sv06', ptcglCode: 'TWM', aliases: ['SV6', 'SV06'], nameFr: 'Mascarade Crépusculaire', nameEn: 'Twilight Masquerade', serie: 'sv', officialCount: 167, releaseDate: '2024-05-24', legalStandard: true, legalExpanded: true },
  { setId: 'sv06.5', ptcglCode: 'SFA', aliases: ['SV6.5', 'SV06.5'], nameFr: 'Fable Nébuleuse', nameEn: 'Shrouded Fable', serie: 'sv', officialCount: 64, releaseDate: '2024-08-02', legalStandard: true, legalExpanded: true },
  { setId: 'sv07', ptcglCode: 'SCR', aliases: ['SV7', 'SV07'], nameFr: 'Couronne Stellaire', nameEn: 'Stellar Crown', serie: 'sv', officialCount: 142, releaseDate: '2024-09-13', legalStandard: true, legalExpanded: true },
  { setId: 'sv08', ptcglCode: 'SSP', aliases: ['SV8', 'SV08'], nameFr: 'Étincelles Déferlantes', nameEn: 'Surging Sparks', serie: 'sv', officialCount: 191, releaseDate: '2024-11-08', legalStandard: true, legalExpanded: true },
  { setId: 'sv08.5', ptcglCode: 'PRE', aliases: ['SV8.5', 'SV08.5'], nameFr: 'Évolutions Prismatiques', nameEn: 'Prismatic Evolutions', serie: 'sv', officialCount: 131, releaseDate: '2025-01-17', legalStandard: true, legalExpanded: true },
  { setId: 'sv09', ptcglCode: 'JTG', aliases: ['SV9', 'SV09'], nameFr: 'Aventures Ensemble', nameEn: 'Journey Together', serie: 'sv', officialCount: 159, releaseDate: '2025-03-28', legalStandard: true, legalExpanded: true },
  { setId: 'sv10', ptcglCode: 'DRI', aliases: ['SV10'], nameFr: 'Rivalités Destinées', nameEn: 'Destined Rivals', serie: 'sv', officialCount: 182, releaseDate: '2025-05-30', legalStandard: true, legalExpanded: true },
  { setId: 'sv10.5w', ptcglCode: 'WHT', aliases: ['SV10.5W', 'WHITE'], nameFr: 'Flamme Blanche', nameEn: 'White Flare', serie: 'sv', officialCount: 86, releaseDate: '2025-07-18', legalStandard: true, legalExpanded: true },
  { setId: 'sv10.5b', ptcglCode: 'BLK', aliases: ['SV10.5B', 'BLACK'], nameFr: 'Foudre Noire', nameEn: 'Black Bolt', serie: 'sv', officialCount: 86, releaseDate: '2025-07-18', legalStandard: true, legalExpanded: true },
  { setId: 'svp', ptcglCode: 'PR-SV', aliases: ['SVP', 'PR-SVI'], nameFr: 'SVP Black Star Promos', nameEn: 'SVP Black Star Promos', serie: 'sv', officialCount: 200, releaseDate: '2023-03-31', legalStandard: true, legalExpanded: true },
  { setId: 'sve', ptcglCode: 'SVE', aliases: ['ENERGY', 'MEE-BASE'], nameFr: 'Écarlate et Violet Énergie', nameEn: 'Scarlet & Violet Energy', serie: 'sv', officialCount: 16, releaseDate: '2023-03-31', legalStandard: true, legalExpanded: true },
  { setId: 'swsh9', ptcglCode: 'BRS', aliases: ['SWSH9', 'SWSH09'], nameFr: 'Stars Étincelantes', nameEn: 'Brilliant Stars', serie: 'swsh', officialCount: 172, releaseDate: '2022-02-25', legalStandard: false, legalExpanded: true },
  { setId: 'swsh10', ptcglCode: 'ASR', aliases: ['SWSH10'], nameFr: 'Astres Radieux', nameEn: 'Astral Radiance', serie: 'swsh', officialCount: 189, releaseDate: '2022-05-27', legalStandard: false, legalExpanded: true },
  { setId: 'swsh10.5', ptcglCode: 'PGO', aliases: ['SWSH10.5'], nameFr: 'Pokémon GO', nameEn: 'Pokémon GO', serie: 'swsh', officialCount: 78, releaseDate: '2022-07-01', legalStandard: false, legalExpanded: true },
  { setId: 'swsh11', ptcglCode: 'LOR', aliases: ['SWSH11'], nameFr: 'Origine Perdue', nameEn: 'Lost Origin', serie: 'swsh', officialCount: 196, releaseDate: '2022-09-09', legalStandard: false, legalExpanded: true },
  { setId: 'swsh12', ptcglCode: 'SIT', aliases: ['SWSH12'], nameFr: 'Tempête Argentée', nameEn: 'Silver Tempest', serie: 'swsh', officialCount: 195, releaseDate: '2022-11-11', legalStandard: false, legalExpanded: true },
  { setId: 'swsh12.5', ptcglCode: 'CRZ', aliases: ['SWSH12.5'], nameFr: 'Zénith Suprême', nameEn: 'Crown Zenith', serie: 'swsh', officialCount: 159, releaseDate: '2023-01-20', legalStandard: false, legalExpanded: true },
  { setId: 'swshp', ptcglCode: 'PR-SW', aliases: ['SWSHP', 'PR-SWSH', 'SWSH'], nameFr: 'Promo SWSH', nameEn: 'SWSH Black Star Promos', serie: 'swsh', officialCount: 307, releaseDate: '2019-11-15', legalStandard: false, legalExpanded: true },
]

const byPtcglCode: Record<string, SetMappingEntry> = {}
const byTcgdexId: Record<string, SetMappingEntry> = {}

for (const entry of VERIFIED_SETS) {
  byPtcglCode[entry.ptcglCode.toUpperCase()] = entry
  byTcgdexId[entry.setId.toLowerCase()] = entry
  for (const alias of entry.aliases) {
    byPtcglCode[alias.toUpperCase()] = entry
  }
}

export function lookupSetMapping(setCode: string | undefined): SetMappingEntry {
  const upper = (setCode || 'SVI').toUpperCase()
  if (byPtcglCode[upper]) return byPtcglCode[upper]!
  if (byTcgdexId[upper.toLowerCase()]) return byTcgdexId[upper.toLowerCase()]!

  const fallback: SetMappingEntry = {
    setId: upper.toLowerCase(),
    ptcglCode: upper,
    aliases: [upper],
    nameFr: `Extension ${upper}`,
    nameEn: `Set ${upper}`,
    serie: upper.startsWith('SWSH') ? 'swsh' : 'sv',
    officialCount: 200,
    releaseDate: '2025-01-01',
    legalStandard: true,
    legalExpanded: true,
  }
  byPtcglCode[upper] = fallback
  return fallback
}
