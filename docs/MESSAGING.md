# Messaging dans Flow.Studio

## Périmètre

Le Studio gère les tables du moteur WOLF Message V1 à côté des parcours Voix V5. Web Messaging est le premier canal proposé. Le média, la version du moteur et le canal sont distincts : un segment Messaging n’est pas un numéro de téléphone ni un déploiement Messenger.

Le contrat des canaux est centralisé dans `src/media-profiles.js`. WhatsApp y est déclaré mais désactivé. Son activation devra préciser les formats acceptés, les contraintes des messages et le raccordement de son adresse ; elle ne doit pas être déduite du nom d’un segment. Le validateur des points d’entrée accepte plusieurs raccordements explicites vers un même parcours. Leur stockage et leur provisionnement Genesys ne sont pas réalisés par cette version du Studio.

## Sources de référence

Implémentation fondée sur les fichiers fournis :

- `WOLF Message – Spécifications fonctionnelles et techniques.md` ;
- `W_TPL_INBOUND_MESSAGE_FLOW_DIVISION_HOME_v1_v130-0.yaml` ;
- `W_DIGITAL_BOT_TPL_DIVISION_HOME_v1.0_v18-0.yaml` ;
- `W_InQueue_TPL_Message_v1_v10-0.yaml`.

Les schémas réellement chargés depuis Genesys restent obligatoires pour éditer, créer et publier les lignes. Les schémas des tests sont synthétiques et ne servent jamais à provisionner une organisation.

## Lecture et édition

L’onglet Messaging présente une entrée par ligne de `W_INBOUND_MESSAGE_v1`. Le graphe résout les segments, services, menus à boutons, carrousels et cartes, questions ouvertes, décisions, horaires, répartitions, bots et rappels. Les tables exactes autorisées sont définies dans `MESSAGE_TABLES`.

Les menus associés à l’attente, cartes et références `pdata` restent rattachés à leur configuration. Une option dont le libellé est vide n’apparaît pas comme choix actif. Les cycles sont conservés ; les références absentes, ambiguës ou dépendant du contexte d’exécution sont signalées.

Le texte `ttm:` est présenté sans préfixe dans l’éditeur puis réencodé à l’enregistrement. Les références `cr:`, `pr:`, `var:` et `img:` existantes sont conservées. La description d’une carte est du contenu affiché au client et ne doit pas être renommée comme une description technique.

La division appartient au parcours. Les nouvelles lignes et copies reprennent sa division ; le panneau d’une étape ne propose pas de la modifier individuellement.

## Création, copie et publication

Le designer crée une entrée Messaging et les blocs dont le schéma chargé permet la création : choix par boutons, carrousel, question ouverte, service, décision, horaires et répartition. La création d’un nouveau bot ou rappel reste indisponible tant que son contrat externe n’est pas entièrement pris en charge. Les configurations existantes restent consultables et leurs champs autorisés peuvent être édités.

La copie d’un parcours réécrit ses références internes et conserve les ressources externes à vérifier. La publication utilise les mêmes contrôles que la voix : organisation, schéma, valeurs d’origine, dépendances, journal et relecture des écritures. Les essais de publication utilisent exclusivement des doubles d’API.

Le Studio ne crée pas de flow Architect, de déploiement Messenger ou de routage Genesys. Il ne fournit pas encore de simulateur de conversation ni de statistiques Messaging.

## Raccordement Web Messaging

1. Charger les tables WOLF Message V1 et leurs schémas dans le Studio.
2. Préparer un segment dont la clé exacte correspond à l’entrée attendue par le flow inbound.
3. Côté intégration Messenger, transmettre `INITIAL_SEGMENT`. À défaut, le flow fourni utilise le nom du déploiement.
4. Pour une reprise de conversation, le flow recherche d’abord la clé suffixée `_THREADING`, puis la clé d’entrée.
5. Configurer dans Genesys le déploiement et son routage vers le flow Architect fourni. Vérifier les appels du bot digital et du flow d’attente, les permissions et les ressources associées.
6. Tester une nouvelle conversation, une reprise, les boutons, une carte, une saisie libre, les horaires et le transfert vers une file avant activation.

L’initialisation par numéro `STUDIO_PARCOURS_INIT_V5` appartient au parcours voix actuel. Les YAML Messaging fournis ne lisent pas cette table. Le contexte Messaging utilise les mécanismes `pdata` du moteur fourni ; cette version n’ajoute pas implicitement un nouveau mécanisme d’initialisation dans Architect.

## Vérification locale

`tests/messaging.test.js` utilise un inventaire mixte entièrement synthétique. Il couvre notamment la séparation voix/Messaging, les canaux, la reprise de conversation, les menus et cartes, la création, la copie, l’édition sans altération des valeurs et la publication avec détection des conflits.

Exécuter `npm test` et `npm run build`, puis vérifier le catalogue et un brouillon avec un export de test. La validation technique locale ne remplace pas l’essai d’une conversation dans une organisation Genesys équipée des tables et flows concernés.
