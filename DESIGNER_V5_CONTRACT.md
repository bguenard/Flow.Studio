# Contrat du designer WOLF V5

Le designer prépare des lignes et des raccordements dans les Data Tables WOLF V5. Il ne crée pas de flow Architect, ne provisionne pas de numéro et ne change pas l’association téléphonique d’un numéro au flow inbound. Ces opérations sont distinctes de la publication des lignes.

## Sources vérifiées

- Document local `doc_technico_fonctionnel_wolf 1.docx`, téléchargements du poste : **Wolf v5 — Documentation fonctionnelle et technique**, exports inbound v131-0 et inqueue v42-0. Sections 5–7, 9–19, 20 et 23. Ce document contient lui-même des réserves sur la concordance avec le YAML publié ; ces réserves restent applicables.
- `INVENTAIRE_DATATABLES_VOIX.json` : relevé des schémas du 23 novembre 2026. Les contraintes du schéma réellement chargé depuis Genesys priment sur ce relevé pour les types, champs autorisés, valeurs par défaut et longueurs.
- Adaptateurs existants `data-source.js`, `flow-clone.js`, `block-insertion.js` et `publication.js` : état de l’implémentation, et non spécification exhaustive du moteur WOLF.

## Identités et création d’une entrée

La clé logique de `W_INBOUND_CALL_v5` est `DNIS_SEGMENT`, exposée par Genesys sous le champ physique `key`. La spécification la décrit comme un **numéro ou segment d’entrée**. Pour un premier appel, l’inbound part du DNIS ; une cible `inboundcall` peut aussi désigner une configuration par sa clé. Il faut conserver la clé exacte, sans supprimer d’espaces ou inventer d’alias de colonne absents du schéma.

Un parcours numéroté peut être déclaré comme référence d’un Core Model sans changer sa clé. L’identité du Core Model et celle du parcours WOLF sont séparées. Le référentiel du Studio conserve ce rôle dans la Data Table Genesys dédiée `STUDIO_CORE_MODEL_RECORDS_V5`, partagée entre les utilisateurs de l’organisation ; il ne fige pas pour autant le contenu d’une version, dont les lignes WOLF restent modifiables.

Une création doit vérifier l’unicité de la clé dans la bonne table V5, la présence d’un schéma exploitable, les champs obligatoires et la cohérence des sorties. Un numéro nouveau dans la table ne devient pas automatiquement joignable : le numéro doit déjà être provisionné et routé vers l’inbound WOLF.

## Blocs de routage

| Type | Table V5 | Réglages et sorties à respecter |
| --- | --- | --- |
| `inboundcall` | `W_INBOUND_CALL_v5` | `DESCRIPTION`, `DIVISION`, `LANGUAGE`, `WELCOME_AUDIO`, `SUBROUTINES_LIST`, triplets `NEXT` et `DEFAULT`. C’est une entrée ; ce n’est pas un bloc ordinaire à insérer. |
| `service` | `W_SERVICES_v5` | File, compétences, langue, priorité, agent direct et attente. `QUEUE=variable` est possible ; cela nécessite un contexte d’exécution. La valeur `PRIORITY` est de type chaîne dans le relevé réel. Sortie `INQUEUE`, menus d’attente rattachés. |
| `menu` | `W_MENU_v5` | Touches 0–9, `OPTIONSTAR`, `OPTIONDIEZ`, repli `DEFAULT`. Les audios des touches sont `OPTIONn_AUDIO`, pas `OPTIONn_TARGET_AUDIO`. Délais réellement implémentés : 3, 5, 7, 10, 12 secondes ; les autres valeurs retombent sur 5 secondes dans le YAML décrit. |
| `schedulegroup` | `W_SCHEDULE_GROUP_v5` | Groupes calendrier et urgence. Sorties `EMERGENCY`, `HOLIDAY`, `CLOSED`, `OPEN`, dans cet ordre d’évaluation fonctionnel. Les groupes vides peuvent provenir de participant data dynamiques. |
| `decision` | `W_DECISION_v5` | `PARTICIPANT_DATA_TO_CHECK`, `DECISION_OPERATOR`, `DECISION_VALUE` ; sorties `TRUE` et `FALSE`. Opérateurs décrits : `exist`, `empty`, `contains`, `==`, `>=`, `<=`, `>`, `<`. |
| `ratiodistrib` | `W_RATIO_DISTRIB_v5` | Cinq ratios `RATIO1` à `RATIO5` et triplets `RATIO1_TARGET_*` à `RATIO5_TARGET_*`. Les ratios nuls ou destinations mal configurées ne participent pas au tirage. Le total n’a pas à être 100. |
| `bot` | `W_BOT_v5` | `ID_BOT`, sorties `NO_MATCH` et `NO_INPUT`, résultats liés à `W_INTENT_v5`. Le document décrit des Data Actions et un contexte de retour ; le simple choix d’un flow Bot ne prouve pas que le contrat de lancement est satisfait. |
| `transfercallflow` | `W_TRANSFER_CALLFLOW_v5` | `FLOW_NAME` ; clé recherchée à l’exécution : `<TARGET>_<Wolf_Version>`, par exemple suffixe `v5.0`. Ce bloc ne possède pas de sortie WOLF à raccorder après le transfert. L’adaptateur historique utilise une recherche directe : cette différence doit être traitée avant de proposer une création naïve. |

Les tables `W_PARTICIPANT_DATA_v5`, `W_RECORDING_V5` et `W_CHECK_*_v5` portent du contexte ou des sous-traitements. Elles ne doivent pas devenir artificiellement des étapes de routage. L’enregistrement décrit par la spécification est limité à l’inbound. Le callback dépend de son propre flow et de tables associées ; son éditeur ne se réduit pas à un bloc générique.

## Raccordements

- Un raccordement comporte type, destination et audio. Le type est la première partie de `TARGET_TYPE`, suivie éventuellement de `|lang:...` et `|sub:...` ; les listes de sous-traitements utilisent `;`.
- `TARGET` comporte la cible principale puis éventuellement `|pdata:clé1;clé2`. Les paramètres existants doivent être préservés lors d’une insertion ; il ne faut ni les perdre ni les exécuter deux fois en les recopiant sur toutes les sorties.
- Une insertion sur une branche doit donner à l’utilisateur le choix de la sortie du nouveau bloc qui reprend la destination antérieure. Les autres sorties doivent être configurées explicitement ou conserver leur sémantique de repli définie.
- Modifier un bloc partagé peut affecter plusieurs parcours. Le designer doit l’indiquer ou imposer une copie indépendante avant le raccordement.
- Les destinations `disconnect`, `number`, `user`, messageries et `next` ne nécessitent pas toutes une ligne WOLF. `next` a une sémantique de continuation de l’attente ; il ne faut pas le présenter comme une fin d’appel.
- Les valeurs `variable`, `var:` et `$var:...$` sont des expressions d’exécution. Le designer ne doit pas inventer leur cible réelle.

## Audio et attente

Les audios acceptent du TTS, des prompts et des combinaisons séparées par `|`. La spécification décrit notamment `tts:`, `pr:`, `prompt:`, `var:`, `barg:` et `edge:`. `WHISPER_AUDIO` est destiné à l’agent et accepte un TTS seul ou un prompt seul. Il ne doit pas être lu comme message à l’appelant.

L’attente comprend une séquence initiale puis quatre séquences, contrôlées par `INQUEUE_REPEAT`. Chaque séquence possède audio, musique, durée, sous-traitements et menu. Une musique sans durée, ou une durée zéro, ne déclenche pas la lecture. Les valeurs par défaut observées sont `MusicHold` et 10 secondes pour l’attente initiale ; elles doivent venir du schéma chargé, pas d’une constante inventée.

## Publication et limites vérifiées

Le writer actuel effectue `POST` pour une nouvelle ligne et `PUT` pour une ligne existante, après relecture, validation du schéma, validation des ressources et contrôle des conflits. Les dépendances nouvelles sont préparées avant les entrées et les raccordements existants. Le journal conserve les résultats confirmés ou incertains. Il n’existe pas de transaction multi-table Genesys : une publication peut être partielle.

Le schéma réel observé rend seulement `key` obligatoire. Cela ne signifie pas qu’une ligne contenant uniquement sa clé constitue un bloc métier fonctionnel. Le designer doit ajouter une validation des règles de son type et empêcher de publier une structure manifestement incomplète.

La documentation V5 signale des divergences entre exports sur les tables PIQ/EWT et certains noms de champs. Elle signale aussi que `inboundcall`, `transfercallflow` et `callback` sont traités par le YAML sans figurer dans certains dictionnaires déclaratifs de types. Ces fonctions nécessitent une vérification contre le flow publié. Le Studio ne peut pas garantir une exécution Architect complète par la seule présence d’un schéma de Data Table.
