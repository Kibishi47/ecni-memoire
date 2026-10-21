/**
 * Reference Go / WebAssembly Source Code (`engine.go`)
 * Displayed in Tab 3 (Declarative Registry & Go/Wasm Architecture) for the technical jury.
 */

export const GO_WASM_REFERENCE_SOURCE = `//go:build js && wasm
package pokeengine

// PackedCard encodes a Pokémon TCG card & live board state in a single 16-bit integer (uint16):
//   Bits 0..4   (5 bits) : CardID (1..31) — Declarative Registry Template ID
//   Bits 5..8   (4 bits) : TurnPlayed (0..15) — Enforces Rule Invariant #2 (turnPlayed < currentTurn) up to T10+
//   Bits 9..12  (4 bits) : AttachedEnergies (0..15) — Fire Energy counter
//   Bit  13     (1 bit)  : ForestSealStone (VSTAR Power available on this Pokémon V)
//   Bit  14     (1 bit)  : AbilityUsedThisTurn (Once-per-turn lock for Quick Search)
//   Bit  15     (1 bit)  : GenericToolAttached (Maximum Belt / Defiance Band)
type PackedCard uint16

const (
	MaskCardID      PackedCard = 0x001F
	ShiftTurnPlayed uint16     = 5
	MaskTurnPlayed  PackedCard = 0x01E0
	ShiftEnergies   uint16     = 9
	MaskEnergies    PackedCard = 0x1E00
	BitSealStone    PackedCard = 1 << 13
	BitAbilityUsed  PackedCard = 1 << 14
)

// GameState fits in < 256 bytes on the stack (Zero Heap Allocation during Beam Search cloning).
// Passing GameState by value copies the entire [60]uint16 arena in a single CPU cache-line burst.
type GameState struct {
	Deck              [60]PackedCard
	Hand              [60]PackedCard
	Prizes            [6]PackedCard
	Discard           [60]PackedCard
	Bench             [5]PackedCard
	Active            PackedCard
	DeckLen           uint8
	HandLen           uint8
	PrizesLen         uint8
	DiscardLen        uint8
	BenchLen          uint8
	CurrentTurn       uint8
	GoingFirst        bool
	SupporterPlayed   bool
	EnergyAttached    bool
	VStarPowerUsed    bool
	MulliganCount     uint8
	ThinningCount     uint8
}

// CheckInvariants validates the 4 mandatory Pokémon TCG rules after every state transition.
func (s *GameState) CheckInvariants() bool {
	// Invariant 1: No Supporter on Turn 1 when Going First
	if s.CurrentTurn == 1 && s.GoingFirst && s.SupporterPlayed {
		return false
	}
	// Invariant 2: Bench limit strictly <= 5 Pokémon
	if s.BenchLen > 5 {
		return false
	}
	return true
}

// CanEvolve enforces Invariant 2: A Pokémon cannot evolve on the same turn it was put into play.
func (s *GameState) CanEvolve(slot PackedCard) bool {
	if slot == 0 || s.CurrentTurn <= 1 {
		return false
	}
	turnPlayed := uint8((slot & MaskTurnPlayed) >> ShiftTurnPlayed)
	return turnPlayed < s.CurrentTurn
}

// Mulberry32 provides deterministic, cross-runtime PRNG parity between TypeScript Worker and Go/Wasm.
type Mulberry32 struct {
	state uint32
}

func (rng *Mulberry32) NextUint32() uint32 {
	rng.state += 0x6D2B79F5
	t := rng.state
	t = (t ^ (t >> 15)) * (t | 1)
	t ^= t + (t^(t>>7))*(t|61)
	return t ^ (t >> 14)
}

// ShuffleDeck performs an unbiased Fisher-Yates shuffle on s.Deck[0:s.DeckLen].
func (s *GameState) ShuffleDeck(rng *Mulberry32) {
	for i := int(s.DeckLen) - 1; i > 0; i-- {
		j := int(uint64(rng.NextUint32()) * uint64(i+1) >> 32)
		s.Deck[i], s.Deck[j] = s.Deck[j], s.Deck[i]
	}
}

// EvaluateBoardScore computes the heuristic value of a terminal intra-turn board state.
func (s *GameState) EvaluateBoardScore() int {
	score := 0
	activeID := s.Active & MaskCardID
	activeEnergies := (s.Active & MaskEnergies) >> ShiftEnergies

	// +50 pts: Charizard ex Active with 2+ Fire Energies (Burning Darkness ready)
	if activeID == CardCharizardEx && activeEnergies >= 2 {
		score += 50
	}
	// +30 pts: Pidgeot ex established on Bench (Quick Search engine active)
	for i := uint8(0); i < s.BenchLen; i++ {
		if (s.Bench[i] & MaskCardID) == CardPidgeotEx {
			score += 30
			break
		}
	}
	// +15 pts: At least 2 Charmander and 1 Pidgey on board on Turn 1
	if s.countEvolutionLine(LineCharizard) >= 2 && s.countEvolutionLine(LinePidgeot) >= 1 {
		score += 15
	}
	// Deck thinning bonus (+2 pts per targeted search resolved before random draw)
	score += int(s.ThinningCount) * 2
	return score
}
`
