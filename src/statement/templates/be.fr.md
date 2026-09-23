# Déclaration d'accessibilité

{{ provider.legalName }} s'engage à rendre le site {{ site.name }} accessible, conformément
au Code de droit économique tel que modifié par la loi du 5 novembre 2023, qui transpose en
droit belge la directive (UE) 2019/882 (European Accessibility Act) pour les services de
commerce électronique et les services bancaires aux consommateurs. Ces obligations
s'appliquent depuis le 28 juin 2025.

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

{{#if review.isSingle}}
Un des {{ review.total }} critères de succès des WCAG 2.2 (niveaux A et AA) a été vérifié
manuellement.
{{/if}}
{{#if review.isPlural}}
{{ review.answered }} des {{ review.total }} critères de succès des WCAG 2.2 (niveaux A et
AA) ont été vérifiés manuellement.
{{/if}}
{{#if review.hasDate}}
La plus récente de ces vérifications manuelles a été effectuée le
{{ review.checkedOnFormatted }}.
{{/if}}
{{#if hasReview}}

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

Si votre demande reste sans réponse satisfaisante, vous pouvez signaler le problème au
SPF Économie, dont la Direction générale de l'Inspection économique contrôle le respect de
ces obligations par les services de commerce électronique.

SPF Économie, P.M.E., Classes moyennes et Énergie
https://economie.fgov.be

En Belgique, le contrôle est réparti : d'autres services visés par la directive, comme les
communications électroniques, relèvent d'autres autorités. Les sites internet et
applications mobiles des organismes du secteur public relèvent d'un régime distinct, qui
prévoit sa propre déclaration d'accessibilité ; le présent document n'en tient pas lieu.

---

Cette déclaration a été générée avec eaa-kit et ne constitue pas un conseil juridique.
Relisez-la avant publication et faites-la vérifier par un juriste en cas de doute.
