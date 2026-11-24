# Contrat d’initialisation Architect — Flow.Studio

## Stockage et clé de lecture

Table dédiée : `STUDIO_PARCOURS_INIT_V5`, division d’hébergement G2S.
La clé `key` est exactement celle de la ligne `W_INBOUND_CALL_v5` utilisée pour l’appel. Utiliser le même numéro normalisé par le routage WOLF ; ne pas supprimer le `+` ni remplacer cette clé par un nom de modèle.

Chaque ligne contient `DESCRIPTION`, `DIVISION` et 15 emplacements :

| Champs | Exemple |
| --- | --- |
| `ATTRIBUTE_01_NAME` | `SC5_ACTIVE` |
| `ATTRIBUTE_01_TYPE` | `bool` |
| `ATTRIBUTE_01_VALUE` | `true` |
| `ATTRIBUTE_02_NAME` | `SC5_ENTITY` |
| `ATTRIBUTE_02_TYPE` | `string` |
| `ATTRIBUTE_02_VALUE` | `gan` |

Aucun découpage `==` ou `||` n’est nécessaire. Nom vide = emplacement inutilisé. Nom renseigné et valeur vide = chaîne vide intentionnelle pour un attribut string, pas false. Les entiers et booléens vides sont refusés. Les noms sont uniques dans une ligne (contrôle insensible à la casse) ; leur casse originale et les valeurs sont conservées à l’écriture. Les trois types sont `string`, `int`, `bool`. Le catalogue définit les contraintes et les choix des listes ; celles-ci sont stockées comme `string`.

## Ordre d’exécution à intégrer au flow

1. Résoudre la clé d’entrée WOLF.
2. Effectuer une recherche dans `STUDIO_PARCOURS_INIT_V5` avec cette clé.
3. Récupérer les quinze triplets.
4. Pour chaque nom non vide, valider son type puis affecter la valeur à l’attribut participant de ce nom.
5. Attendre le succès des affectations avant la première condition WOLF.

Les attributs participant restent des chaînes : `bool` et `int` décrivent le format attendu. Ne pas transformer les valeurs string ni les libellés de liste. Convertir explicitement les nombres lors d’un test numérique ; une comparaison de chaînes n’est pas une comparaison numérique.

Une ligne absente, un type invalide ou un échec d’affectation doit suivre une branche d’erreur explicite choisie par le responsable du flow. Ne pas les interpréter comme un ensemble d’attributs à false. Les lignes présentes sans aucun nom sont valides et n’affectent aucun attribut.

## Noms libres

Le bloc natif Set Participant Data utilise des noms configurés dans Architect. Ne pas supposer qu’une variable placée dans ce champ sera évaluée comme un nom dynamique. Pour accepter de nouveaux noms du catalogue sans republier le flow, réutiliser le mécanisme générique WOLF existant s’il sait réellement affecter des noms dynamiques, ou implémenter une Data Action dédiée.

L’API Genesys expose `PATCH /api/v2/conversations/calls/{conversationId}/participants/{participantId}/attributes` pour affecter un objet d’attributs. La Data Action doit cibler le participant appelant correct, encoder proprement les noms et valeurs et conserver les autres attributs. Le contrat et le traitement d’erreur de cette action restent à intégrer et tester dans Architect ; cette migration de tables ne les déploie pas. Ne pas laisser une ancienne affectation locale/cachée remplacer ensuite la valeur écrite par l’API.

## Bascule sans casser les appels

La migration Studio a seulement copié les données, avec vérification après écriture. Les références historiques sont conservées. Tant que le flow Architect n’a pas été adapté, il continue donc à utiliser les anciennes valeurs.

Tester le nouveau lecteur sur un numéro contrôlé, puis vérifier dans les données participant les noms, valeurs, booléens false, chaînes vides et cas d’erreur. Vérifier les conditions et les choix de menu. Après validation, publier la bascule du flow et retirer uniquement les anciennes affectations d’entrée de chaque parcours migré ; une affectation ancienne exécutée après le nouveau lecteur pourrait sinon écraser les nouvelles valeurs.

Conserver les groupes de contexte après menu (`*_CONTEXT_CONSEIL`, `*_CONTEXT_CONTRAT`, `*_CONTEXT_SINISTRE`) : ils renseignent le motif au moment du choix, pas à l’entrée. Ne supprimer une ligne `*_ACTIVATION` qu’après avoir vérifié qu’aucune référence ne l’utilise encore. Aucun nettoyage destructif n’est effectué par le bouton de migration.

## Core Models

Les valeurs initiales sont effectives par numéro. La création d’une déclinaison ou d’une nouvelle version copie les valeurs de la source vers le nouveau numéro. Une évolution ultérieure du modèle ne modifie pas automatiquement les valeurs des enfants : leur personnalisation reste conservée. Les types appartiennent au catalogue commun, pas à une déclinaison.

## Références

- [Limites et utilisation des Data Tables Genesys](https://help.genesys.cloud/articles/work-with-data-tables/)
- [API Conversations — affectation des attributs](https://github.com/MyPureCloud/platform-client-sdk-javascript/blob/master/build/docs/ConversationsApi.md#patchConversationsCallParticipantAttributes)
