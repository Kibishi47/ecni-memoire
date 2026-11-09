import 'reveal.js/dist/reveal.css';
import 'reveal.js/dist/theme/white.css';
import Reveal from 'reveal.js';
import RevealNotes from 'reveal.js/plugin/notes/notes.esm.js';

// 1. Garantir que tous les blocs <aside class="notes"> possèdent l'attribut data-markdown
document.querySelectorAll('aside.notes').forEach((el) => {
  if (!el.hasAttribute('data-markdown')) {
    el.setAttribute('data-markdown', '');
  }
});

// 2. Intercepter l'ouverture de la console d'orateur pour injecter un style soigné et forcer l'interprétation Markdown
const originalOpen = window.open;
window.open = function (...args) {
  const win = originalOpen.apply(this, args);
  if (win && args[1] === 'reveal.js - Notes') {
    // Intercepter postMessage sur la fenêtre speaker pour s'assurer que markdown: true est toujours transmis
    const origPostMessage = win.postMessage;
    win.postMessage = function (msg, targetOrigin, transfer) {
      if (typeof msg === 'string' && msg.includes('"reveal-notes"') && msg.includes('"state"')) {
        try {
          const parsed = JSON.parse(msg);
          if (parsed.type === 'state') {
            parsed.markdown = true;
            msg = JSON.stringify(parsed);
          }
        } catch (e) {
          // fallback silencieux
        }
      }
      return origPostMessage.call(this, msg, targetOrigin, transfer);
    };

    // Injecter des styles CSS modernes pour des notes ultra-lisibles dans la console d'orateur
    const injectSpeakerStyles = () => {
      try {
        if (!win.document || !win.document.head) return;
        if (win.document.getElementById('custom-speaker-notes-style')) return;

        const style = win.document.createElement('style');
        style.id = 'custom-speaker-notes-style';
        style.textContent = `
          body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif !important;
          }
          .speaker-controls-notes {
            padding: 18px 24px !important;
          }
          .speaker-controls-notes .label {
            font-size: 0.8rem !important;
            letter-spacing: 0.08em !important;
            font-weight: 700 !important;
            color: #64748b !important;
            text-transform: uppercase !important;
            margin-bottom: 10px !important;
          }
          .speaker-controls-notes .value {
            font-size: 1.12rem !important;
            line-height: 1.65 !important;
            color: #1e293b !important;
            margin-top: 10px !important;
          }
          .speaker-controls-notes .value h1,
          .speaker-controls-notes .value h2,
          .speaker-controls-notes .value h3 {
            font-size: 1.35rem !important;
            font-weight: 700 !important;
            color: #0f172a !important;
            margin: 16px 0 10px 0 !important;
            padding-bottom: 8px !important;
            border-bottom: 2px solid #e2e8f0 !important;
            line-height: 1.3 !important;
          }
          .speaker-controls-notes .value h4 {
            font-size: 1.15rem !important;
            font-weight: 600 !important;
            color: #2563eb !important;
            margin: 12px 0 6px 0 !important;
          }
          .speaker-controls-notes .value p {
            margin: 10px 0 14px 0 !important;
          }
          .speaker-controls-notes .value ul,
          .speaker-controls-notes .value ol {
            padding-left: 24px !important;
            margin: 10px 0 16px 0 !important;
          }
          .speaker-controls-notes .value li {
            margin-bottom: 10px !important;
            line-height: 1.6 !important;
          }
          .speaker-controls-notes .value strong {
            font-weight: 700 !important;
            color: #0f172a !important;
          }
          .speaker-controls-notes .value code {
            background: #f1f5f9 !important;
            color: #0f172a !important;
            padding: 2px 6px !important;
            border-radius: 4px !important;
            font-size: 0.9em !important;
            font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace !important;
          }
          .speaker-controls-notes .value blockquote {
            border-left: 4px solid #3b82f6 !important;
            margin: 12px 0 !important;
            padding: 8px 16px !important;
            background: #f8fafc !important;
            color: #334155 !important;
            font-style: italic !important;
          }
        `;
        win.document.head.appendChild(style);
      } catch (err) {
        // En cas de restriction cross-origin
      }
    };

    const intervalId = setInterval(() => {
      try {
        if (win.document && win.document.querySelector('.speaker-controls-notes')) {
          injectSpeakerStyles();
          clearInterval(intervalId);
        }
      } catch (err) {
        clearInterval(intervalId);
      }
    }, 80);

    setTimeout(() => clearInterval(intervalId), 4000);
  }
  return win;
};

// 3. Initialisation Reveal.js
const deck = new Reveal({
  hash: true,
  slideNumber: 'c/t',
  plugins: [ RevealNotes ]
});
deck.initialize();

console.info("💡 Appuyez sur 'S' pour ouvrir la console d'orateur avec toutes les notes détaillées.");
