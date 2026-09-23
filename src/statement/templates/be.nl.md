# Toegankelijkheidsverklaring

{{ provider.legalName }} zet zich in om de website {{ site.name }} toegankelijk te maken,
in overeenstemming met het Wetboek van economisch recht zoals gewijzigd door de wet van
5 november 2023, waarmee richtlijn (EU) 2019/882 (European Accessibility Act) voor
diensten op het gebied van elektronische handel en bankdiensten voor consumenten in
Belgisch recht is omgezet. Deze verplichtingen gelden sinds 28 juni 2025.

Deze toegankelijkheidsverklaring geldt voor {{ site.url }}.

## Nalevingsstatus

{{#if compliance.isCompliant}}
Deze website voldoet volledig aan {{ compliance.standard }}.
{{/if}}
{{#if compliance.isPartiallyCompliant}}
Deze website voldoet gedeeltelijk aan {{ compliance.standard }}. De inhoud die hieronder
staat is niet toegankelijk, om de genoemde redenen.
{{/if}}
{{#if compliance.isNonCompliant}}
Deze website voldoet niet aan {{ compliance.standard }}. De inhoud die hieronder staat is
niet toegankelijk, om de genoemde redenen.
{{/if}}

## Niet-toegankelijke inhoud

{{#if hasKnownIssues}}
{{#each compliance.knownIssues}}
- {{ description }}
{{#if standards}}
  Betrokken eis: {{ standards }}
{{/if}}
{{#if pageList}}
  Betrokken pagina's: {{ pageList }}{{#if hasMorePages}} en {{ morePages }} andere{{/if}}
{{/if}}
{{#if isDisproportionateBurden}}
  Reden: onevenredige last.
{{/if}}
{{#if isOutOfScope}}
  Reden: de inhoud valt buiten het toepassingsgebied van deze verplichtingen.
{{/if}}
{{#if isFixPlanned}}
  Reden: de drempel is bekend en wordt verholpen.
{{/if}}
{{#if remedyByFormatted}}
  Verwacht verholpen op: {{ remedyByFormatted }}
{{/if}}
{{#if isFromAudit}}
  Vastgesteld met een geautomatiseerde test (axe-core, regel {{ ruleId }}); beschrijf dit in eigen woorden.
{{/if}}
{{/each}}
{{/if}}
{{#if hasNoKnownIssues}}
Op het moment van de beoordeling was er geen niet-toegankelijke inhoud bekend.
{{/if}}

## Opstelling van deze verklaring

Deze verklaring is opgesteld op {{ compliance.assessedOnFormatted }}.

{{#if compliance.isSelfAssessment}}
Zij berust op een zelfbeoordeling door {{ provider.legalName }}.
{{/if}}
{{#if compliance.isExternalAudit}}
Zij berust op een beoordeling door een derde partij.
{{/if}}

{{#if review.isSingle}}
Eén van de {{ review.total }} succescriteria van WCAG 2.2 (niveaus A en AA) is handmatig
gecontroleerd.
{{/if}}
{{#if review.isPlural}}
{{ review.answered }} van de {{ review.total }} succescriteria van WCAG 2.2 (niveaus A en
AA) zijn handmatig gecontroleerd.
{{/if}}
{{#if review.hasDate}}
De meest recente van deze handmatige controles is uitgevoerd op
{{ review.checkedOnFormatted }}.
{{/if}}
{{#if hasReview}}

{{/if}}
{{#if audit.isSinglePage}}
De geautomatiseerde test van {{ audit.checkedOnFormatted }} betrof één pagina van deze
website.
{{/if}}
{{#if audit.isMultiPage}}
De geautomatiseerde test van {{ audit.checkedOnFormatted }} betrof {{ audit.pages }}
pagina's van deze website.
{{/if}}
{{#if audit.needsReviewIsSingle}}
Voor één andere regelcontrole is een menselijke beoordeling nodig.
{{/if}}
{{#if audit.needsReviewIsPlural}}
Voor {{ audit.needsReview }} andere regelcontroles is een menselijke beoordeling nodig.
{{/if}}
{{#if audit.notEvaluatedIsSingle}}
Bij één regelcontrole kwam het gebruikte gereedschap niet tot een uitkomst; die wordt niet
als voldaan gepresenteerd.
{{/if}}
{{#if audit.notEvaluatedIsPlural}}
Bij {{ audit.notEvaluated }} regelcontroles kwam het gebruikte gereedschap niet tot een
uitkomst; die worden niet als voldaan gepresenteerd.
{{/if}}
{{#if hasAudit}}

{{/if}}
De beoordeling berust mede op geautomatiseerd testen. Geautomatiseerde gereedschappen
vinden maar een deel van de mogelijke drempels; zij vervangen geen handmatige test en geen
test met hulptechnologie.

## Reactie en contact

Een drempel tegengekomen, of informatie nodig in een toegankelijke vorm? Laat het ons
weten:

- E-mail: {{ provider.email }}
{{#if provider.feedbackUrl}}
- Contactformulier: {{ provider.feedbackUrl }}
{{/if}}
{{#if provider.phone}}
- Telefoon: {{ provider.phone }}
{{/if}}
{{#if provider.address}}
- Adres: {{ provider.address }}
{{/if}}

Wij streven ernaar snel te reageren.

## Handhavingsprocedure

Bent u niet tevreden met onze reactie, dan kunt u het probleem melden bij de FOD Economie,
waarvan de Algemene Directie Economische Inspectie toeziet op de naleving door diensten op
het gebied van elektronische handel.

FOD Economie, K.M.O., Middenstand en Energie
https://economie.fgov.be

Het toezicht is in België verdeeld: voor andere diensten waarop de richtlijn van toepassing
is, zoals elektronische communicatie, zijn andere toezichthouders bevoegd. Websites en
mobiele applicaties van overheidsinstanties vallen onder een afzonderlijke regeling, met een
eigen toegankelijkheidsverklaring; dit document vervangt die niet.

---

Deze verklaring is gemaakt met eaa-kit en is geen juridisch advies. Lees haar na voordat u
haar publiceert en laat haar bij twijfel juridisch toetsen.
