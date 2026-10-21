package pokeengine

// Mulberry32 provides deterministic, bit-exact PRNG parity between TypeScript Web Worker and Go/Wasm.
type Mulberry32 struct {
	state uint32
}

func NewMulberry32(seed uint32) Mulberry32 {
	if seed == 0 {
		seed = 0x9E3779B9
	}
	return Mulberry32{state: seed}
}

func (rng *Mulberry32) NextUint32() uint32 {
	rng.state += 0x6D2B79F5
	t := rng.state
	t = (t ^ (t >> 15)) * (t | 1)
	t ^= t + (t^(t>>7))*(t|61)
	return t ^ (t >> 14)
}

func (rng *Mulberry32) NextInt(maxExclusive int) int {
	if maxExclusive <= 1 {
		return 0
	}
	return int((uint64(rng.NextUint32()) * uint64(maxExclusive)) >> 32)
}

// DeriveGameSeed computes an uncorrelated per-game seed from the master seed and game index.
func DeriveGameSeed(masterSeed uint32, gameIndex uint32) uint32 {
	z := masterSeed + (gameIndex+1)*0x9E3779B9
	z = (z ^ (z >> 16)) * 0x85EBCA6B
	z = (z ^ (z >> 13)) * 0xC2B2AE35
	return z ^ (z >> 16)
}

// ShuffleDeck performs an unbiased in-place Fisher-Yates shuffle on s.Deck[0:s.DeckLen].
func (s *GameState) ShuffleDeck(rng *Mulberry32) {
	for i := int(s.DeckLen) - 1; i > 0; i-- {
		j := rng.NextInt(i + 1)
		s.Deck[i], s.Deck[j] = s.Deck[j], s.Deck[i]
	}
}
