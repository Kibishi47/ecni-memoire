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
