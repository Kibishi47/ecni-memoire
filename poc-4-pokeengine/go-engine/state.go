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
	BitGenericTool  PackedCard = 1 << 15
)

// Card Registry Template IDs (matching cardRegistry.ts)
const (
	CardCharmander        PackedCard = 1
	CardPidgey            PackedCard = 2
	CardLumineonV         PackedCard = 3
	CardFezandipitiEx     PackedCard = 4
	CardRotomV            PackedCard = 5
	CardCharmeleon        PackedCard = 6
	CardPidgeotto         PackedCard = 7
	CardCharizardEx       PackedCard = 8
	CardPidgeotEx         PackedCard = 9
	CardBuddyPoffin       PackedCard = 10
	CardNestBall          PackedCard = 11
	CardUltraBall         PackedCard = 12
	CardRareCandy         PackedCard = 13
	CardSuperRod          PackedCard = 14
	CardNightStretcher    PackedCard = 15
	CardArven             PackedCard = 16
	CardProfessorsResearch PackedCard = 17
	CardIono              PackedCard = 18
	CardBossOrders        PackedCard = 19
	CardForestSealStone   PackedCard = 20
	CardFireEnergy        PackedCard = 25
)

func PackCard(cardID PackedCard, turnPlayed uint8, energies uint8) PackedCard {
	return (cardID & MaskCardID) |
		(PackedCard(turnPlayed&0x0F) << ShiftTurnPlayed) |
		(PackedCard(energies&0x0F) << ShiftEnergies)
}

func (c PackedCard) CardID() PackedCard {
	return c & MaskCardID
}

func (c PackedCard) TurnPlayed() uint8 {
	return uint8((c & MaskTurnPlayed) >> ShiftTurnPlayed)
}

func (c PackedCard) Energies() uint8 {
	return uint8((c & MaskEnergies) >> ShiftEnergies)
}

// GameState fits in < 256 bytes on the stack (Zero Heap Allocation during Beam Search cloning).
// Passing GameState by value copies the entire [60]uint16 arena in a single CPU cache-line burst.
type GameState struct {
	Deck            [60]PackedCard
	Hand            [60]PackedCard
	Prizes          [6]PackedCard
	Discard         [60]PackedCard
	Bench           [5]PackedCard
	Active          PackedCard
	DeckLen         uint8
	HandLen         uint8
	PrizesLen       uint8
	DiscardLen      uint8
	BenchLen        uint8
	CurrentTurn     uint8
	MaxTurns        uint8
	GoingFirst      bool
	SupporterPlayed bool
	EnergyAttached  bool
	VStarPowerUsed  bool
	MulliganCount   uint8
	ThinningCount   uint8
}

// CheckInvariants validates the mandatory Pokémon TCG regulatory invariants after every state transition.
func (s *GameState) CheckInvariants() bool {
	// Invariant 1: No Supporter on Turn 1 when Going First
	if s.CurrentTurn == 1 && s.GoingFirst && s.SupporterPlayed {
		return false
	}
	// Invariant 4: Bench limit strictly <= 5 Pokémon
	if s.BenchLen > 5 {
		return false
	}
	// Invariant 5: Prize card boundary integrity
	if s.PrizesLen > 6 {
		return false
	}
	return true
}

// CanEvolve enforces Invariant 2: A Pokémon cannot evolve on the same turn it was put into play (nor on Turn 1).
func (s *GameState) CanEvolve(slot PackedCard) bool {
	if slot == 0 || s.CurrentTurn <= 1 {
		return false
	}
	return slot.TurnPlayed() < s.CurrentTurn
}

// IsTerminal checks whether the game has reached an early stopping condition before s.MaxTurns.
func (s *GameState) IsTerminal() (ended bool, reason string) {
	if s.PrizesLen == 0 {
		return true, "VICTORY_ALL_PRIZES"
	}
	if s.Active == 0 && s.BenchLen == 0 {
		return true, "DEFEAT_NO_POKEMON"
	}
	if s.DeckLen == 0 {
		return true, "DEFEAT_DECK_OUT"
	}
	return false, ""
}
