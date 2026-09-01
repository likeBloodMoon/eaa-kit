# Déclaration d'accessibilité

{{ provider.legalName }} s'engage à rendre le site {{ site.name }} accessible, conformément
à l'ordonnance n° 2023-859 du 6 septembre 2023, qui transpose en droit français la
directive (UE) 2019/882 (European Accessibility Act), et à l'article 47 de la loi
n° 2005-102 du 11 février 2005.

Cette déclaration d'accessibilité s'applique à {{ site.url }}.

## État de conformité

{{#if compliance.isCompliant}}
Ce site est totalement conforme à {{ compliance.standard }}.
{{/if}}
{{#if compliance.isPartiallyCompliant}}
Ce site est partiellement conforme à {{ compliance.standard }}. Les contenus énumérés
ci-dessous ne sont pas accessibles, pour les motifs indiqués.
{{/if}}
{{#if compliance.isNonCompliant}}
Ce site n'est pas conforme à {{ compliance.standard }}. Les contenus énumérés ci-dessous ne
sont pas accessibles, pour les motifs indiqués.
{{/if}}

## Contenus non accessibles

{{#if hasKnownIssues}}
{{#each compliance.knownIssues}}
- {{ description }}
{{#if standards}}
  Exigence concernée : {{ standards }}
{{/if}}
{{#if pageList}}
  Pages concernées : {{ pageList }}{{#if hasMorePages}} et {{ morePages }} autres{{/if}}
{{/if}}
{{#if isDisproportionateBurden}}
  Motif : charge disproportionnée.
{{/if}}
{{#if isOutOfScope}}
  Motif : le contenu n'entre pas dans le champ d'application de ces obligations.
{{/if}}
{{#if isFixPlanned}}
  Motif : la barrière est connue et sa correction est engagée.
{{/if}}
{{#if remedyByFormatted}}
  Correction prévue avant le : {{ remedyByFormatted }}
{{/if}}
{{#if isFromAudit}}
  Détecté par un test automatisé (axe-core, règle {{ ruleId }}) ; à reformuler dans vos propres mots.
{{/if}}
{{/each}}
{{/if}}
{{#if hasNoKnownIssues}}
Aucun contenu non accessible n'était connu au moment de l'évaluation.
{{/if}}

## Établissement de cette déclaration

Cette déclaration a été établie le {{ compliance.assessedOnFormatted }}.

{{#if compliance.isSelfAssessment}}
Elle repose sur une auto-évaluation réalisée par {{ provider.legalName }}.
{{/if}}
{{#if compliance.isExternalAudit}}
Elle repose sur une évaluation réalisée par un tiers.
{{/if}}

{{#if audit.isSinglePage}}
Le test automatisé du {{ audit.checkedOnFormatted }} a porté sur une page de ce site.
{{/if}}
{{#if audit.isMultiPage}}
Le test automatisé du {{ audit.checkedOnFormatted }} a porté sur {{ audit.pages }} pages de
ce site.
{{/if}}
{{#if audit.needsReviewIsSingle}}
Une autre vérification de règle demande une appréciation humaine.
{{/if}}
{{#if audit.needsReviewIsPlural}}
{{ audit.needsReview }} autres vérifications de règles demandent une appréciation humaine.
{{/if}}
{{#if audit.notEvaluatedIsSingle}}
Une vérification de règle n'a pu être tranchée par l'outil utilisé ; elle n'est pas
présentée comme satisfaite.
{{/if}}
{{#if audit.notEvaluatedIsPlural}}
{{ audit.notEvaluated }} vérifications de règles n'ont pu être tranchées par l'outil
utilisé ; elles ne sont pas présentées comme satisfaites.
{{/if}}
{{#if hasAudit}}

{{/if}}
L'évaluation repose en partie sur des tests automatisés. Les outils automatisés ne
détectent qu'une partie des barrières possibles ; ils ne remplacent ni un test manuel ni un
test avec des technologies d'assistance.

## Retour d'information et contact

Vous avez rencontré une barrière, ou vous avez besoin d'une information sous une forme
accessible ? Écrivez-nous :

- Courriel : {{ provider.email }}
{{#if provider.feedbackUrl}}
- Formulaire de contact : {{ provider.feedbackUrl }}
{{/if}}
{{#if provider.phone}}
- Téléphone : {{ provider.phone }}
{{/if}}
{{#if provider.address}}
- Adresse : {{ provider.address }}
{{/if}}

Nous nous efforçons de répondre à votre message dans les meilleurs délais.

## Voies de recours

Si votre demande reste sans réponse satisfaisante, vous pouvez :

- écrire au Défenseur des droits, ou contacter le délégué du Défenseur des droits de votre
  département : https://www.defenseurdesdroits.fr
- signaler le manquement à l'Arcom, qui contrôle les obligations d'accessibilité numérique
  de l'article 47 de la loi n° 2005-102 : https://www.arcom.fr

Si vous relevez de cet article 47 — service public en ligne, ou entreprise dont le chiffre
d'affaires moyen réalisé en France sur les trois derniers exercices clos dépasse
250 millions d'euros — votre déclaration d'accessibilité doit suivre le modèle du RGAA,
s'appuyer sur un audit RGAA et s'accompagner d'un schéma pluriannuel de mise en
accessibilité. Le présent document n'en tient pas lieu.

---

Cette déclaration a été générée avec eaa-kit et ne constitue pas un conseil juridique.
Relisez-la avant publication et faites-la vérifier par un juriste en cas de doute.
