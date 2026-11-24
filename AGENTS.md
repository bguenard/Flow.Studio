# Travail dans Flow.Studio

- Ce dépôt est la source de référence. Modifier les fichiers ici ; l’ancien dossier de livraison peut être un lien de compatibilité.
- Application statique JavaScript natif : conserver l’architecture existante et les conventions des modules touchés.
- Lire le README et, pour le designer, DESIGNER_V5_CONTRACT.md.
- Préserver les configurations Genesys existantes et les champs non concernés. Les essais automatisés utilisent des doubles d’API, pas des écritures dans l’organisation réelle.
- Les définitions du catalogue sont communes ; les valeurs d’initialisation restent propres aux parcours. Préserver les clés techniques et les valeurs historiques inchangées.
- Ne jamais ajouter de secrets, tokens, exports de conversations ou fichiers .env au dépôt.
- Vérification avant livraison : npm test et npm run build. Tester visuellement les changements d’interface quand le navigateur est disponible.
- dist/ est généré : modifier src/, puis reconstruire. Conserver la licence du code embarqué dans src/vendor/.
