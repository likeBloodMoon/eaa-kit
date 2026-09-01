# Toegankelijkheidsverklaring

{{ provider.legalName }} zet zich in om de website {{ site.name }} toegankelijk te maken,
in overeenstemming met de Implementatiewet toegankelijkheidsvoorschriften producten en
diensten, waarmee richtlijn (EU) 2019/882 (European Accessibility Act) in Nederlands recht
is omgezet. De wet geldt sinds 28 juni 2025.

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
  Reden: de inhoud valt buiten het toepassingsgebied van deze wet.
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

Bent u niet tevreden met onze reactie, dan kunt u een melding doen bij de toezichthouder.
Het toezicht is over meerdere toezichthouders verdeeld: voor diensten zoals webwinkels en
klantenservice is dat de Autoriteit Consument & Markt (ACM), voor producten zoals
smartphones, e-readers en betaalautomaten de Rijksinspectie Digitale Infrastructuur (RDI).

Autoriteit Consument & Markt
https://www.acm.nl

---

Deze verklaring is gemaakt met eaa-kit en is geen juridisch advies. Lees haar na voordat u
haar publiceert en laat haar bij twijfel juridisch toetsen.
