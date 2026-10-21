/**
 * Live Reference Loader for the `./go-engine/` Go/WebAssembly directory.
 * Imports the actual `.go` and `go.mod` files using Vite's `?raw` loader so any edit
 * made in `./poc-4-pokeengine/go-engine/*.go` is immediately reflected in the UI.
 */

import evaluatorGoRaw from '../../go-engine/evaluator.go?raw'
import goModRaw from '../../go-engine/go.mod?raw'
import prngGoRaw from '../../go-engine/prng.go?raw'
import stateGoRaw from '../../go-engine/state.go?raw'
import wasmMainGoRaw from '../../go-engine/wasm_main.go?raw'

export interface GoSourceFileEntry {
  filename: string
  relativePath: string
  description: string
  content: string
}

export const GO_ENGINE_FILES: GoSourceFileEntry[] = [
  {
    filename: 'state.go',
    relativePath: 'go-engine/state.go',
    description: 'Struct GameState [60]uint16 (Zero-Allocation), Bit-Packing PackedCard & Vérification des Invariants',
    content: stateGoRaw,
  },
  {
    filename: 'prng.go',
    relativePath: 'go-engine/prng.go',
    description: 'PRNG Déterministe Mulberry32, Dérivation de Seed par Partie & Mélange de Fisher-Yates',
    content: prngGoRaw,
  },
  {
    filename: 'evaluator.go',
    relativePath: 'go-engine/evaluator.go',
    description: 'Fonction de Score de Plateau EvaluateBoardScore() (+50 Dracaufeu ex, +30 Roucarnage ex, +15 Setup T1)',
    content: evaluatorGoRaw,
  },
  {
    filename: 'wasm_main.go',
    relativePath: 'go-engine/wasm_main.go',
    description: 'Point d’entrée WebAssembly (//go:build js && wasm) & Boucle de Simulation avec Arrêt Anticipé',
    content: wasmMainGoRaw,
  },
  {
    filename: 'go.mod',
    relativePath: 'go-engine/go.mod',
    description: 'Définition du module Go (pokeengine)',
    content: goModRaw,
  },
]

export const GO_WASM_REFERENCE_SOURCE = [
  '// === Dossier : ./poc-4-pokeengine/go-engine/ ===',
  '',
  '// --- [1/4] go-engine/state.go ---',
  stateGoRaw.trim(),
  '',
  '// --- [2/4] go-engine/prng.go ---',
  prngGoRaw.trim(),
  '',
  '// --- [3/4] go-engine/evaluator.go ---',
  evaluatorGoRaw.trim(),
  '',
  '// --- [4/4] go-engine/wasm_main.go ---',
  wasmMainGoRaw.trim(),
].join('\n')
