# Tillgänglighetsredogörelse

{{ provider.legalName }} strävar efter att göra webbplatsen {{ site.name }} tillgänglig i
enlighet med lagen (2023:254) om vissa produkters och tjänsters tillgänglighet, som genomför
direktiv (EU) 2019/882 (tillgänglighetsdirektivet) i svensk rätt. Lagens krav gäller från
den 28 juni 2025.

Den här tillgänglighetsredogörelsen gäller {{ site.url }}.

## Efterlevnadsstatus

{{#if compliance.isCompliant}}
Webbplatsen är helt förenlig med {{ compliance.standard }}.
{{/if}}
{{#if compliance.isPartiallyCompliant}}
Webbplatsen är delvis förenlig med {{ compliance.standard }}. Innehållet som anges nedan är
inte tillgängligt, av de skäl som anges.
{{/if}}
{{#if compliance.isNonCompliant}}
Webbplatsen är inte förenlig med {{ compliance.standard }}. Innehållet som anges nedan är
inte tillgängligt, av de skäl som anges.
{{/if}}

## Innehåll som inte är tillgängligt

{{#if hasKnownIssues}}
{{#each compliance.knownIssues}}
- {{ description }}
{{#if standards}}
  Berört krav: {{ standards }}
{{/if}}
{{#if pageList}}
  Berörda sidor: {{ pageList }}{{#if hasMorePages}} och {{ morePages }} till{{/if}}
{{/if}}
{{#if isDisproportionateBurden}}
  Skäl: oskälig börda.
{{/if}}
{{#if isOutOfScope}}
  Skäl: innehållet omfattas inte av lagens tillämpningsområde.
{{/if}}
{{#if isFixPlanned}}
  Skäl: bristen är känd och håller på att åtgärdas.
{{/if}}
{{#if remedyByFormatted}}
  Planeras vara åtgärdat senast: {{ remedyByFormatted }}
{{/if}}
{{#if isFromAudit}}
  Upptäckt vid automatiserad testning (axe-core, regel {{ ruleId }}); beskriv det med egna ord.
{{/if}}
{{/each}}
{{/if}}
{{#if hasNoKnownIssues}}
Vid bedömningen var inget otillgängligt innehåll känt.
{{/if}}

## Hur redogörelsen har tagits fram

Redogörelsen upprättades den {{ compliance.assessedOnFormatted }}.

{{#if compliance.isSelfAssessment}}
Den bygger på en självskattning som {{ provider.legalName }} har gjort.
{{/if}}
{{#if compliance.isExternalAudit}}
Den bygger på en bedömning som en tredje part har gjort.
{{/if}}

{{#if review.isSingle}}
Ett av de {{ review.total }} framgångskriterierna i WCAG 2.2 (nivå A och AA) har
kontrollerats manuellt.
{{/if}}
{{#if review.isPlural}}
{{ review.answered }} av de {{ review.total }} framgångskriterierna i WCAG 2.2 (nivå A och
AA) har kontrollerats manuellt.
{{/if}}
{{#if review.hasDate}}
Den senaste av dessa manuella kontroller registrerades den {{ review.checkedOnFormatted }}.
{{/if}}
{{#if hasReview}}

{{/if}}
{{#if audit.isSinglePage}}
Den automatiserade testningen den {{ audit.checkedOnFormatted }} omfattade en sida på
webbplatsen.
{{/if}}
{{#if audit.isMultiPage}}
Den automatiserade testningen den {{ audit.checkedOnFormatted }} omfattade {{ audit.pages }}
sidor på webbplatsen.
{{/if}}
{{#if audit.needsReviewIsSingle}}
Ytterligare en regelkontroll kräver en manuell bedömning.
{{/if}}
{{#if audit.needsReviewIsPlural}}
Ytterligare {{ audit.needsReview }} regelkontroller kräver en manuell bedömning.
{{/if}}
{{#if audit.notEvaluatedIsSingle}}
En regelkontroll kunde inte avgöras av verktyget som användes; den redovisas inte som
uppfylld.
{{/if}}
{{#if audit.notEvaluatedIsPlural}}
{{ audit.notEvaluated }} regelkontroller kunde inte avgöras av verktyget som användes; de
redovisas inte som uppfyllda.
{{/if}}
{{#if hasAudit}}

{{/if}}
Bedömningen bygger delvis på automatiserad testning. Automatiserade verktyg hittar bara en
del av de möjliga bristerna; de ersätter inte manuell testning eller testning med
hjälpmedel.

## Återkoppling och kontaktuppgifter

Har du hittat en brist, eller behöver du information i ett tillgängligt format? Kontakta
oss:

- E-post: {{ provider.email }}
{{#if provider.feedbackUrl}}
- Kontaktformulär: {{ provider.feedbackUrl }}
{{/if}}
{{#if provider.phone}}
- Telefon: {{ provider.phone }}
{{/if}}
{{#if provider.address}}
- Adress: {{ provider.address }}
{{/if}}

Vi strävar efter att svara så snart som möjligt.

## Tillsyn

Om du inte är nöjd med vårt svar kan du anmäla saken till Post- och telestyrelsen (PTS), som
har tillsyn över e-handelstjänster enligt lagen.

Post- och telestyrelsen (PTS)
https://pts.se

Offentliga aktörers webbplatser och mobila applikationer omfattas av en annan lag, som
kräver en egen tillgänglighetsredogörelse. Det här dokumentet ersätter inte den.

---

Redogörelsen har tagits fram med eaa-kit och är inte juridisk rådgivning. Granska den innan
den publiceras, och låt en jurist granska den om du är osäker.
