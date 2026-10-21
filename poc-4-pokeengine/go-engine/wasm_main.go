//go:build js && wasm

package pokeengine

import "syscall/js"

// RunMonteCarloWasm exposes the zero-allocation [60]uint16 simulation loop to the browser Web Worker.
func RunMonteCarloWasm(this js.Value, args []js.Value) any {
	iterations := args[0].Int()
	maxTurns := uint8(args[1].Int())
	seed := uint32(args[2].Int())

	if maxTurns < 1 {
		maxTurns = 1
	} else if maxTurns > 10 {
		maxTurns = 10
	}

	totalScore := 0
	earlyStops := 0

	for i := 0; i < iterations; i++ {
		gameSeed := DeriveGameSeed(seed, uint32(i))
		rng := NewMulberry32(gameSeed)
		state := GameState{
			DeckLen:   60,
			PrizesLen: 6,
			MaxTurns:  maxTurns,
		}
		state.ShuffleDeck(&rng)

		for turn := uint8(1); turn <= maxTurns; turn++ {
			state.CurrentTurn = turn
			if ended, _ := state.IsTerminal(); ended {
				earlyStops++
				break
			}
		}
		totalScore += state.EvaluateBoardScore()
	}

	return map[string]any{
		"iterations": iterations,
		"maxTurns":   int(maxTurns),
		"avgScore":   float64(totalScore) / float64(iterations),
		"earlyStops": earlyStops,
	}
}
