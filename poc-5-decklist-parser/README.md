# PokéParser Studio — POC #5 : PTCGL Decklist Parser, ID Extractor & Ratio Tuner

Mini-projet web autonome permettant de :
1. **Générer la table de correspondance PTCGL $\leftrightarrow$ TCGdex** via le script TypeScript [`scripts/generate-mapping.ts`](./scripts/generate-mapping.ts).
2. **Coller une deckliste au format Pokémon TCG Live (PTCGL)** ou Limitless (en français ou en anglais).
3. **Extraire les identifiants des cartes utilisées** (`sv01-166`, `sv03-125`, `sv03.5-004`...) ainsi que le **schéma JSON `identity` complet** avec les URLs d'assets TCGdex.
4. **Modifier interactivement les ratios (quantités de cartes)** avec validation temps réel de la jauge des 60 cartes.
5. **Réexporter le deck modifié au format officiel PTCGL** (en français ou en anglais).

## Commandes

```bash
# 1. Générer / rafraîchir la table de correspondance JSON
npm run generate-mapping
# (ou avec synchronisation live de l'API TCGdex : node scripts/generate-mapping.ts --fetch)

# 2. Lancer les tests unitaires automatisés (Vitest)
npm test

# 3. Lancer l'interface web en développement
npm run dev

# 4. Vérifier le typage et compiler pour la production
npm run build
```
