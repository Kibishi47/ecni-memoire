import 'reveal.js/dist/reveal.css';
import 'reveal.js/dist/theme/white.css';
import Reveal from 'reveal.js';
import RevealNotes from 'reveal.js/plugin/notes/notes.esm.js';

const deck = new Reveal({
  hash: true,
  slideNumber: 'c/t',
  plugins: [ RevealNotes ]
});
deck.initialize();

console.info("💡 Appuyez sur 'S' pour ouvrir la console d'orateur avec toutes les notes détaillées.");
