package pokeengine

// EvaluateBoardScore computes the heuristic value of a terminal intra-turn board state.
//   +50 pts : Charizard ex Active with 2+ Fire Energies (Burning Darkness ready)
//   +30 pts : Pidgeot ex established on Bench (Quick Search engine active)
//   +15 pts : At least 2 Charmander-line and 1 Pidgey-line on board
//   +2  pts : Per targeted deck-thinning card extracted before random draw
func (s *GameState) EvaluateBoardScore() int {
	score := 0
	activeID := s.Active.CardID()
	activeEnergies := s.Active.Energies()

	// 1. Primary Criterion (+50 pts): Charizard ex Active with 2+ Fire Energies
	if activeID == CardCharizardEx && activeEnergies >= 2 {
		score += 50
	}

	// 2. Secondary Criterion (+30 pts): Pidgeot ex established on Bench
	for i := uint8(0); i < s.BenchLen; i++ {
		if s.Bench[i].CardID() == CardPidgeotEx {
			score += 30
			break
		}
	}

	// 3. Foundation Criterion (+15 pts): 2+ Charizard line & 1+ Pidgeot line in play
	if s.CountLineInPlay( true ) >= 2 && s.CountLineInPlay( false ) >= 1 {
		score += 15
	}

	// 4. Deck Thinning bonus (+2 pts per targeted search resolved before random draw)
	score += int(s.ThinningCount) * 2
	return score
}

func (s *GameState) CountLineInPlay(charizardLine bool) int {
	count := 0
	checkSlot := func(slot PackedCard) {
		if slot == 0 {
			return
		}
		cid := slot.CardID()
		if charizardLine {
			if cid == CardCharmander || cid == CardCharmeleon || cid == CardCharizardEx {
				count++
			}
		} else {
			if cid == CardPidgey || cid == CardPidgeotto || cid == CardPidgeotEx {
				count++
			}
		}
	}
	checkSlot(s.Active)
	for i := uint8(0); i < s.BenchLen; i++ {
		checkSlot(s.Bench[i])
	}
	return count
}
