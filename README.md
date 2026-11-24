# Flow.Studio — WOLF Core Studio

Application métier pour consulter, adapter, comparer, simuler et publier les parcours WOLF V5 dans Genesys Cloud Dublin.

## Travailler dans ce dépôt

Ce dépôt est désormais la source de référence de l’application. Le frontend utilise **JavaScript natif, HTML et CSS**, sans Vue ni étape de compilation de framework. Node.js 24 est indiqué dans `.nvmrc` ; le projet accepte Node.js 20 ou supérieur. Aucune dépendance npm externe n’est nécessaire pour démarrer ou lancer les tests ; ELK est embarqué avec sa licence.

```sh
nvm use             # si nvm est installé
npm ci              # installer les outils de développement
npm run format:check # vérifier la mise en forme
npm run dev         # http://127.0.0.1:4173/
npm test            # tests Node.js, sans compte Genesys requis
npm run build       # application statique dans dist/
npm run preview     # servir dist/ sur le même port
```

Le formatage est assuré par Prettier, installé uniquement comme dépendance de développement. `npm run format` remet en forme les sources, tests et scripts ; les fichiers tiers et les sorties générées sont exclus. Les événements sont gérés dans les modules JavaScript, les styles statiques dans les feuilles CSS et la géométrie calculée dans `src/view-layout.js`, sans attribut `style` ni gestionnaire JavaScript inline.

Arrêter le serveur de développement avant de lancer l’aperçu, ou choisir un autre port avec `PORT=4174 npm run preview`.

| Chemin | Contenu |
| --- | --- |
| `src/` | Interface, logique métier et clients Genesys |
| `tests/` | Tests automatisés et contrôles de non-régression |
| `scripts/` | Serveur local et génération de `dist/` |
| `server/` | Adaptateur backend de lecture optionnel |
| `docs/` | Notes de reprise et documentation complémentaire |
| `DESIGNER_V5_CONTRACT.md` | Contrat du designer et limites WOLF V5 |
| `INVENTAIRE_DATATABLES_VOIX.json` | Inventaire des schémas utilisé par les tests |
| `amplify.yml` | Tests, build et répertoire à déployer sur Amplify |

Les builds, archives ZIP, exports locaux et fichiers `.env` ne sont pas versionnés. `.env.example` décrit uniquement le backend optionnel : l’application statique ne charge pas ce fichier. La configuration OAuth publique du navigateur se règle dans **Connexion → Configuration de la connexion** ; aucun secret client ne doit y être renseigné.

## Déployer sur AWS Amplify

Deux modes sont possibles : connecter ce dépôt à Amplify et utiliser `amplify.yml`, ou importer une archive du contenu de `dist/`. Le build exécute les tests avant de produire les fichiers statiques. Pour un ZIP manuel, `index.html` doit être **à la racine de l’archive**, sans dossier `dist/` englobant :

```sh
npm test
npm run build
(cd dist && zip -r ../flow-studio-amplify.zip .)
```

Configurer l’URL HTTPS exacte du site comme URI de redirection du client OAuth Genesys. Le déploiement du site ne publie aucune configuration WOLF et ne modifie pas les flows Architect.

## Démarrage

```sh
npm run dev
```

Ouvrir `http://127.0.0.1:4173/`. L’application lance directement la connexion Genesys OAuth Authorization Code + PKCE. Le client OAuth public et son URI de redirection doivent être configurés dans Genesys. Aucun secret OAuth n’est embarqué. La session OAuth est conservée dans le localStorage de cette origine jusqu’à son expiration Genesys (avec une marge de sécurité), puis supprimée. Une déconnexion ou un changement de client OAuth invalide la session. Le mot de passe, le secret client et les refresh tokens ne sont pas stockés. Ce stockage est accessible au JavaScript de l’application ; un déploiement avec session serveur et cookie HttpOnly pourra remplacer ce mécanisme si nécessaire. La politique MFA/SSO reste appliquée par Genesys.

```sh
npm test
npm run build
```

Les données de test ne sont pas proposées dans la connexion de l’application. `src/demo-snapshot.js` demeure une fixture de tests. Les fichiers de `server/` décrivent un adaptateur de lecture optionnel ; le chemin actif du navigateur utilise la session de l’utilisateur.

## Fonctions disponibles

- Périmètre voix WOLF **V5 uniquement** : tables `W_*_v5`, hors messagerie.
- Vue Métier organisée par réglages et vue Administration avec carte du parcours et données sources.
- Nom de l’étape en premier, champs renseignés affichés par défaut ; zéro et faux restent visibles.
- TTS ou message enregistré, listes Genesys avec recherche : files, calendriers, urgences, compétences, langues, utilisateurs, scripts, flows, prompts et bots. Bot externe possible par identifiant explicite.
- Comparaison de valeurs et insertion choisie de blocs avec examen des raccordements.
- Reprise des brouillons, saisies et créations dans IndexedDB, séparés par organisation et utilisateur. Les choix de comparaison sont conservés ; la revue de publication doit toujours être renouvelée.
- Core Models : familles, versions, déclinaisons et périmètres déclarés, enregistrés dans la Data Table Genesys dédiée `STUDIO_CORE_MODEL_RECORDS_V5`. Ces déclarations sont écrites dès leur validation, hors du centre de publication ; elles nécessitent une connexion Genesys et restent en lecture seule avec un export local.
- Contrôle de configuration : références non résolues, contraintes des schémas, destinations dynamiques, rapport exportable et accès à l’étape concernée.
- Studio d’appel : branches du parcours réel chargé, choix au clavier vocal, version Genesys ou modifications enregistrées, retour à l’étape précédente, synthèse vocale du navigateur, fil d’appel, mode présentation et export du scénario.
- Activité du numéro : analytics Genesys en lecture, sous réserve des permissions du compte.
- Centre de publication avec sélection des lignes, aperçu avant/après, contrôles distants, écritures, relecture, historique, rapprochement d’une réponse incertaine et préparation d’une restauration.

## Publication réelle

Depuis **Mes changements → Publier dans Genesys** :

1. Sélectionner les lignes à publier. Les créations de blocs et leurs raccordements sont publiés ensemble.
2. Vérifier dans Genesys : organisation et utilisateur, identité V5 des tables, schémas à jour, existence des lignes, modifications concurrentes et catalogues des ressources modifiées.
3. Examiner les valeurs qui seront réellement envoyées. Les modifications distantes portant sur d’autres champs sont conservées.
4. Publier : POST pour une nouvelle ligne, PUT pour une ligne existante. Les lignes nouvelles précèdent les modifications de raccordement ; les entrées nouvelles sont placées après les autres créations.
5. Chaque écriture doit être confirmée par relecture avant d’être annoncée comme vérifiée.

La publication n’est jamais déclenchée par « Enregistrer le brouillon ». Un import ne permet pas à lui seul de publier. La revue expire après cinq minutes ; une modification du brouillon exige un nouveau contrôle.

Permissions Genesys documentées :

- Mise à jour : `architect:datatable:edit` **ou** `architect:datatableRow:edit`.
- Création : `architect:datatable:add` **ou** `architect:datatableRow:add`.
- Lecture des tables, schémas et ressources, identité de l’utilisateur et organisation nécessaires aux contrôles. Les scopes OAuth et divisions autorisées doivent correspondre aux droits du compte.

Référence officielle : [Architect API — JavaScript SDK](https://github.com/MyPureCloud/platform-client-sdk-javascript/blob/master/build/docs/ArchitectApi.md).

## Échecs et restauration

- Le journal avant/après doit être enregistré avant une écriture. Un stockage indisponible bloque son démarrage.
- Aucun POST ou PUT n’est réessayé automatiquement après une erreur réseau.
- Une réponse perdue ou une relecture impossible est classée « Résultat à vérifier ». « Vérifier l’état » relit les lignes et distingue appliqué, non appliqué et différence à examiner.
- Un échec interrompt les écritures suivantes. Les lignes déjà confirmées restent identifiées.
- « Préparer la restauration » produit une nouvelle revue et applique les mêmes contrôles de conflit. Les nouvelles lignes ne sont **pas supprimées** automatiquement.
- Un verrou Web Locks empêche deux publications simultanées du Studio dans les onglets d’un même navigateur/origine. Ce verrou ne couvre pas les autres navigateurs ni Architect.

## Limites importantes avant exploitation multi-utilisateur

Le chemin d’écriture est implémenté ; cela ne constitue pas une certification d’exploitation de votre environnement.

- Les Data Tables ne sont pas une transaction multi-lignes. La relecture préalable ne supprime pas la course entre le dernier GET et le PUT d’un autre outil. Aucun support ETag/If-Match n’est supposé.
- L’historique IndexedDB est persistant dans ce navigateur, exportable, mais **pas un audit serveur immuable**. Un service central d’audit, une coordination inter-utilisateurs et un processus d’approbation demandent un backend déployé et configuré.
- La vue Métier/Administration est un choix d’interface, pas une frontière d’autorisation. Genesys applique les permissions réelles du compte à chaque opération.
- Les contrats des Data Actions, les règles du flow WOLF V5 publié, les conventions exactes des références et les bots externes doivent être qualifiés avec les artefacts déployés. Une DT ne décrit pas à elle seule ces comportements.
- Publier une entrée dans une DT ne provisionne pas un numéro téléphonique et ne crée pas l’association DNIS → IVR → flow publié.
- La simulation est guidée, sans émission d’appel, exécution des bots/Data Actions ni calcul réel de disponibilité des agents ou calendriers. La lecture automatique utilise la voix TTS du navigateur ou les ressources audio des prompts Genesys dans la langue du parcours. Elle ne reproduit pas la voix de synthèse Genesys. Un message dynamique, absent ou inaccessible met la lecture en pause avec une explication.
- Une recette sur un numéro Genesys dédié reste nécessaire pour valider la prise en compte des DT, les caches éventuels, la lecture audio et le routage réels.

## Vérification de cette livraison

Tests automatisés : rédaction des lignes, conflits, schémas, ressources absentes, erreurs de permission, journal indisponible, réponse perdue, écriture partielle, restauration, simulateur, contrôle de configuration et non-régressions du Studio.

Recette navigateur isolée : modification d’un message, reprise après rechargement, contrôle/publication/relecture, restauration, menu DTMF et branches d’horaires. Les requêtes d’écriture de cette recette sont interceptées par un double d’API ; **aucune ligne de l’organisation Genesys réelle n’a été écrite pour tester**.

### Chargement et vérification du compte

La lecture des parcours reste accessible si les Data Tables sont lisibles mais que la vérification du compte échoue. L’organisation est demandée dans `GET /api/v2/users/me?expand=organization`, puis via `/organizations/me` seulement si elle manque. Les erreurs indiquent l’opération et l’API refusées ; elles ne présument pas un manque de droits d’écriture lors d’une lecture.

Sans identité vérifiée, la publication et la reprise automatique du stockage par compte restent bloquées. Les modifications de la session peuvent être exportées. Une erreur 401 reste bloquante et demande une reconnexion.

### Déroulement du simulateur

Le bouton **Dérouler le parcours** enchaîne les transitions simples. Les menus, horaires, décisions, bots et événements de distribution attendent un choix explicite. La mise en file d’un service ouvre l’attente ; elle ne termine plus la simulation. Les menus d’attente retournent au service sur `next`, puis les branches de débordement restent accessibles. Une réponse agent ou un raccrochage peuvent être simulés.

Les destinations dynamiques ou non résolues peuvent être poursuivies vers une étape du parcours via une **hypothèse explicite**, tracée dans l’export. Ce choix ne répare ni ne modifie la configuration et ne prétend pas exécuter une Data Action. La limite de 80 transitions prévient les boucles sans fin. Le simulateur déroule une branche choisie de l’appel, pas simultanément toutes les branches du graphe.


### Lecture et suivi visuel de l’appel

Le son est activé par défaut. Après **Dérouler le parcours**, les annonces de transition puis les messages de l’étape sont lus dans l’ordre ; la transition automatique attend la fin effective de la lecture. **Mettre en pause**, changer d’étape, revenir en arrière ou quitter le simulateur annule le son en cours. **Relire les messages** redémarre la lecture ; **Couper le son** permet de poursuivre sans audio.

Le parcours en direct met en évidence l’étape courante, les étapes visitées et les liaisons effectivement empruntées. Il se recentre à chaque transition, montre aussi les menus d’attente et respecte le retour en arrière. Les résultats de bots, calendriers et conditions restent des choix explicites de simulation.

Les prompts sont résolus par nom exact et langue via `GET /api/v2/architect/prompts` avec `includeResources` et `includeMediaUris`. Aucun jeton n’est transmis à l’URL audio. Une erreur de permission ou de lecture est affichée ; un enregistrement absent n’est pas remplacé par sa transcription supposée.


### Designer WOLF V5

Depuis **Parcours clients → Créer un parcours**, préparez une nouvelle entrée numérotée. En vue **Administration**, utilisez **Ajouter un bloc** pour insérer un menu, une équipe, un calendrier, une décision ou une répartition, puis **Raccorder les étapes** pour modifier une branche. Les listes et champs proviennent des schémas V5 chargés ; les ressources Genesys restent recherchables.

La revue indique les nouvelles lignes, les destinations modifiées, les étapes partagées et les étapes devenues inaccessibles. Les annonces et options de transition sont conservées. L’application prépare un brouillon récupérable après rechargement, puis réutilise le centre de publication. Les nouvelles dépendances sont créées avant les raccordements existants. Les écritures multi-tables ne sont pas transactionnelles : le journal indique les lignes confirmées en cas d’échec partiel.

Ce designer construit les configurations interprétées par WOLF ; il ne génère pas de flow Architect et ne provisionne pas de numéro. Les créations de bots, de transferts versionnés, de sous-traitements et de contextes PDATA ne sont pas proposées comme blocs ordinaires. Voir [le contrat V5](DESIGNER_V5_CONTRACT.md) pour les sources, contraintes et limites.

## Comparatif des appels et contrôles de mise en service

Le bouton **Avant / après l’appel** compare la version chargée depuis Genesys aux modifications enregistrées. Les scénarios **Crise**, **Agence fermée** et **File saturée** appliquent les mêmes hypothèses aux deux versions ; le choix de menu et les attributs peuvent être ajustés. Les messages sont lus à tour de rôle, les cartes suivent les étapes parcourues et le résultat peut être exporté. Le mode **Présenter** libère l’espace pour les deux parcours. Une nouvelle création sans version Genesys affiche explicitement l’absence d’Avant.

Le comparatif simule un seul cycle d’attente accéléré, sans musique ni temporisations réelles. Les annonces et menus d’attente sont parcourus dans l’ordre configuré, puis la sortie configurée est suivie. Les résultats inconnus de bots, Data Actions et conditions exigent un choix explicite. La synthèse utilise la voix du navigateur, pas la voix Genesys ; cette simulation ne remplace pas une recette téléphonique réelle.

**Activité sur le parcours** active à la demande les mesures Genesys sur le parcours chargé. Les volumes du numéro et les observations de ses files restent distingués, notamment lorsqu’une file est partagée. Aucune mesure n’est attribuée artificiellement aux décisions ou aux calendriers. L’actualisation s’effectue toutes les 30 secondes et s’arrête quand la carte est désactivée, à la navigation, à la déconnexion ou lorsque l’onglet est masqué. Les données absentes ou périmées sont signalées.

Le centre de publication contrôle la sélection exacte des lignes : contraintes V5, références, dépendances, changements de destinations et parcours concernés. Les nouvelles anomalies bloquent la préparation et l’écriture. Les anomalies déjà présentes sont distinguées. Après la vérification distante, le contrôle utilise aussi les lignes fraîchement relues et demande une nouvelle vérification si le brouillon a évolué. Les dépendances dynamiques et les ressources externes conservent leurs limites de validation explicites.

## Chargement progressif du catalogue

Au démarrage, le Studio lit en priorité les lignes de `W_INBOUND_CALL_V5` et le référentiel `STUDIO_CORE_MODEL_RECORDS_V5`. Le catalogue et le filtre Core Model deviennent disponibles avant les autres configurations. Les noms et identifiants des tables accessibles sont toujours inventoriés pour sélectionner le périmètre voix V5.

Les autres tables voix V5 sont ensuite lues en arrière-plan, avec au plus trois lectures de tables simultanées. Les réglages, simulations, analyses, reprises de brouillons et publications attendent le chargement complet : une source partielle ne doit pas devenir une source éditable ou remplacer des brouillons persistés. Un échec laisse le catalogue consultable et propose de relancer la lecture. Déconnexion ou nouveau chargement annulent le précédent.

## Catalogue administrateur des données

Depuis **Administration → Catalogue des données**, créer ou modifier une définition avec une clé technique unique, un libellé métier, une division propriétaire, un type et une valeur par défaut facultative.

| Type | Contrôle dans les parcours et conditions |
| --- | --- |
| Texte | Champ texte |
| Entier | Nombre entier signé, sans décimale ni notation exponentielle |
| Oui / Non | Interrupteur ; la valeur absente reste distincte de Non |
| Liste de valeurs | Liste fermée de libellés associés à des valeurs techniques stables |

Les définitions sont enregistrées dans `STUDIO_PARTICIPANT_DATA_V5` : `key`, `LABEL`, `DIVISION`, `DIVISION_ID`, `VALUE_TYPE`, `DEFAULT_VALUE`, `ALLOWED_VALUES`. Ce dernier champ contient une liste JSON de couples `{value,label}`. Les valeurs exécutées par WOLF restent des chaînes : le catalogue apporte des contraintes métier, sans changer leur représentation dans Architect.

La division de la table contrôle son hébergement et ses accès Genesys. La division d’une définition indique son propriétaire, sans constituer une isolation de sécurité par ligne. Le catalogue commun peut servir aux parcours de différentes divisions.

Les clés existantes sont immuables. Les libellés peuvent être renommés. Une modification du type ou des valeurs autorisées est contrôlée contre les initialisations et conditions V5 relues dans Genesys ; une incompatibilité est refusée. Les valeurs calculées pendant l’appel sont signalées : leur résultat ne peut pas être vérifié statiquement. Une nouvelle définition refuse les noms dupliqués et variantes de casse.

**Vérifier la définition** prépare une revue qui expire après cinq minutes. **Enregistrer dans Genesys** relit la définition, ses usages et la division avant l’écriture, puis confirme le résultat par relecture. Cette opération porte uniquement sur le catalogue. Elle ne remplace aucune valeur dans les parcours. Les publications ne sont pas transactionnelles et une écriture incertaine n’est pas réessayée automatiquement.

Le catalogue est lu après les tables WOLF, sans retarder le premier affichage des entrées. S’il manque, cette page permet de créer la table dédiée. Pour une ancienne table du Studio, **Activer le catalogue typé** ajoute uniquement `ALLOWED_VALUES` et vérifie la conservation des colonnes et lignes existantes. Une table homonyme incompatible est refusée. L’API Genesys permet cet ajout de colonne sans modifier les colonnes existantes ([Architect API officielle](https://github.com/MyPureCloud/platform-client-sdk-javascript/blob/master/build/docs/ArchitectApi.md)).

**Référencer des attributs WOLF existants** propose un import séparé, depuis les tables V5 relues hors brouillons. Les noms déjà catalogués sont ignorés. Les attributs partagés utilisent la division commune choisie, avec une valeur par défaut vide lorsque leurs valeurs diffèrent. Cet import ne crée que des définitions dans le catalogue.

## Données du parcours

Depuis un parcours ou un Core Model, **Données du parcours** permet de choisir une donnée du catalogue et de renseigner sa valeur avec le contrôle adapté. La création libre d’attributs est réservée au catalogue administrateur. Les conditions utilisent également ce catalogue et ne proposent que les opérateurs compatibles avec le type.

La définition est commune ; la valeur est propre au numéro dans `STUDIO_PARCOURS_INIT_V5`. La vérification prépare le brouillon de cette ligne dédiée ; **Mes changements** le publie après contrôle des types et des choix autorisés. Les raccordements WOLF ne sont pas modifiés par cet écran.

Architect doit lire cette table avant les conditions concernées. Les données obtenues plus tard pendant l’appel restent renseignées par les étapes correspondantes. Une déclinaison copie les valeurs à sa création ; les nouvelles versions du Core Model ne les propagent pas automatiquement aux enfants existants.

## Bibliothèque embarquée

Le diagramme de la vue Administration est placé par [ELK](https://github.com/kieler/elkjs) (elkjs 0.12.1), copié tel quel dans `src/vendor/elk.bundled.js` avec sa licence (`src/vendor/elkjs-LICENSE.md`, EPL-2.0 ou GPL-3.0-or-later). Le fichier (1,6 Mo) n’est chargé qu’à l’ouverture du premier diagramme ; l’application reste statique et ne demande aucune installation.

Le Studio fournit à ELK les cartes, leurs sorties et les liens (`src/journey-diagram.js`) ; ELK renvoie les positions et le tracé à angles droits. La carte de simulation et la carte d’activité utilisent encore l’ancien placement fait main (`layoutJourney` dans `src/journey-canvas.js`).

## Initialisation des participant data par numéro

L’écran **Administration → Initialisation par numéro** permet de consulter et, si elle manque, de créer la table dédiée `STUDIO_PARCOURS_INIT_V5`. La clé est le numéro exact de l’entrée WOLF (signe `+` conservé). La table comporte `DESCRIPTION`, `DIVISION` et quinze triplets `ATTRIBUTE_01_NAME`, `ATTRIBUTE_01_TYPE`, `ATTRIBUTE_01_VALUE` jusqu’à `ATTRIBUTE_15_*` : 48 colonnes au total.

Les valeurs se modifient dans **Parcours → Données du parcours**, puis suivent la revue et la publication habituelles. Les noms et contraintes proviennent du catalogue administrateur `STUDIO_PARTICIPANT_DATA_V5`. Texte et liste correspondent au type de stockage `string`, entier à `int`, Oui/Non à `bool`. La valeur reste une chaîne exacte ; le type sert à la contrôler. Une liste conserve ses choix autorisés dans le catalogue.

Les numéros sans ligne dédiée sont initialisés depuis **Données du parcours**. Le Studio ne copie plus automatiquement les anciens groupes `pdata:` et ne propose plus d’outil de migration. Les lignes WOLF et les affectations de contexte pendant l’appel restent gérées séparément.

**La table seule n’active pas l’initialisation dans Architect.** Le flow doit lire la ligne par numéro et affecter les attributs avant toute condition qui les consulte. La bascule du lecteur et le retrait des anciennes affectations d’entrée sont une étape distincte, à valider par des appels avant nettoyage. Voir [le contrat Architect](docs/INITIALISATION_ARCHITECT.md).

Une nouvelle déclinaison ou version copie les quinze emplacements vers son nouveau numéro, avec sa division. Les valeurs des enfants déjà créés ne sont pas réécrites automatiquement lors d’une évolution du Core Model.

## Référentiel Core Models en lignes distinctes

`STUDIO_CORE_MODEL_RECORDS_V5` remplace le registre JSON global. L’application ne lit plus `STUDIO_CORE_MODELS_V5` et n’embarque pas de conversion automatique de l’ancien format.

| RECORD_TYPE | Une ligne représente | Colonnes principales |
| --- | --- | --- |
| MODEL | Une famille de parcours | MODEL_ID, MODEL_NAME |
| VERSION | Une version de référence | MODEL_ID, FLOW_ID, VERSION_LABEL |
| DECLINATION | Le rattachement d’un parcours | MODEL_ID, FLOW_ID, BASE_FLOW_ID, SCOPE |
| MAPPING | Une correspondance d’étapes | FLOW_ID, REFERENCE_NODE_ID, LOCAL_NODE_ID |

Chaque ligne porte `DIVISION_ID` (identifiant Genesys) et `DIVISION` (nom lisible). Le modèle prend la division de sa première version ; chaque version prend celle de son parcours de référence ; une déclinaison et ses correspondances prennent celle de son propre parcours. Les noms proviennent du catalogue des divisions Genesys. Une division absente ou ambiguë bloque l’enregistrement. La division qui héberge la Data Table est choisie séparément à sa création. **Ces colonnes ne constituent pas une restriction d’accès par ligne** : les droits Genesys restent ceux de la Data Table.

Les clés restent stables lors d’un renommage. Le Studio n’écrit que les lignes modifiées et conserve l’ordre des versions avec `POSITION`. Les suppressions de déclarations passent à `STATUS=deleted` ; elles ne suppriment aucun parcours WOLF.

Un verrou temporaire `write_lock`, créé par POST avec une clé unique, empêche deux écritures du Studio de se chevaucher. Le journal temporaire contient les lignes avant/après dans des colonnes explicites. Le Studio vérifie les réponses et les empreintes avant de clôturer l’opération. En cas de coupure, il refuse de charger un ensemble partiel et propose **Reprendre l’enregistrement** : une préparation est abandonnée, une écriture commencée est terminée, une écriture validée est simplement clôturée. Ne lancer cette reprise qu’après l’arrêt de l’autre enregistrement éventuel. Les modifications directes dans Genesys sont vérifiées avant écriture mais ne participent pas au verrou du Studio.

Les permissions Architect Datatable Row Add, Edit **et Delete** sont nécessaires. Delete sert exclusivement à retirer le verrou et le journal temporaires ; les lignes métier restent conservées. Une erreur pendant la clôture laisse une opération récupérable. Aucune nouvelle tentative d’écriture n’est faite silencieusement après une erreur réseau. Les appels d’enregistrement sont espacés pour respecter les quotas Genesys ; une lecture limitée par HTTP 429 peut être relancée une seule fois après le délai indiqué. Le chargement normal ne subit pas cet espacement.
