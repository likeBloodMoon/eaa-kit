# Tilgængelighedserklæring

{{ provider.legalName }} arbejder på at gøre websitet {{ site.name }} tilgængeligt i
overensstemmelse med lov nr. 801 af 7. juni 2022 om tilgængelighedskrav for produkter og
tjenester, som gennemfører direktiv (EU) 2019/882 (tilgængelighedsdirektivet) i dansk ret.
Lovens krav gælder for tjenester, der leveres fra den 28. juni 2025.

Denne tilgængelighedserklæring gælder for {{ site.url }}.

## Overholdelsesstatus

{{#if compliance.isCompliant}}
Dette website overholder fuldt ud {{ compliance.standard }}.
{{/if}}
{{#if compliance.isPartiallyCompliant}}
Dette website overholder delvist {{ compliance.standard }}. Det indhold, der er angivet
nedenfor, er ikke tilgængeligt af de anførte grunde.
{{/if}}
{{#if compliance.isNonCompliant}}
Dette website overholder ikke {{ compliance.standard }}. Det indhold, der er angivet
nedenfor, er ikke tilgængeligt af de anførte grunde.
{{/if}}

## Indhold, der ikke er tilgængeligt

{{#if hasKnownIssues}}
{{#each compliance.knownIssues}}
- {{ description }}
{{#if standards}}
  Berørt krav: {{ standards }}
{{/if}}
{{#if pageList}}
  Berørte sider: {{ pageList }}{{#if hasMorePages}} og {{ morePages }} andre{{/if}}
{{/if}}
{{#if isDisproportionateBurden}}
  Begrundelse: uforholdsmæssig stor byrde.
{{/if}}
{{#if isOutOfScope}}
  Begrundelse: indholdet er ikke omfattet af lovens anvendelsesområde.
{{/if}}
{{#if isFixPlanned}}
  Begrundelse: barrieren er kendt og ved at blive udbedret.
{{/if}}
{{#if remedyByFormatted}}
  Forventes udbedret senest: {{ remedyByFormatted }}
{{/if}}
{{#if isFromAudit}}
  Fundet ved automatisk test (axe-core, regel {{ ruleId }}); beskriv det med dine egne ord.
{{/if}}
{{/each}}
{{/if}}
{{#if hasNoKnownIssues}}
Da vurderingen blev foretaget, var der ikke kendskab til indhold, der ikke er tilgængeligt.
{{/if}}

## Udarbejdelse af denne erklæring

Erklæringen blev udarbejdet den {{ compliance.assessedOnFormatted }}.

{{#if compliance.isSelfAssessment}}
Den bygger på en selvevaluering foretaget af {{ provider.legalName }}.
{{/if}}
{{#if compliance.isExternalAudit}}
Den bygger på en vurdering foretaget af en tredjepart.
{{/if}}

{{#if review.isSingle}}
Et af de {{ review.total }} succeskriterier i WCAG 2.2 (niveau A og AA) er kontrolleret
manuelt.
{{/if}}
{{#if review.isPlural}}
{{ review.answered }} af de {{ review.total }} succeskriterier i WCAG 2.2 (niveau A og AA)
er kontrolleret manuelt.
{{/if}}
{{#if review.hasDate}}
Den seneste af disse manuelle kontroller blev registreret den {{ review.checkedOnFormatted
}}.
{{/if}}
{{#if hasReview}}

{{/if}}
{{#if audit.isSinglePage}}
Den automatiske test den {{ audit.checkedOnFormatted }} omfattede én side på dette website.
{{/if}}
{{#if audit.isMultiPage}}
Den automatiske test den {{ audit.checkedOnFormatted }} omfattede {{ audit.pages }} sider på
dette website.
{{/if}}
{{#if audit.needsReviewIsSingle}}
Yderligere én regelkontrol kræver en manuel vurdering.
{{/if}}
{{#if audit.needsReviewIsPlural}}
Yderligere {{ audit.needsReview }} regelkontroller kræver en manuel vurdering.
{{/if}}
{{#if audit.notEvaluatedIsSingle}}
Én regelkontrol kunne ikke afgøres af det anvendte værktøj; den angives ikke som opfyldt.
{{/if}}
{{#if audit.notEvaluatedIsPlural}}
{{ audit.notEvaluated }} regelkontroller kunne ikke afgøres af det anvendte værktøj; de
angives ikke som opfyldt.
{{/if}}
{{#if hasAudit}}

{{/if}}
Vurderingen bygger delvis på automatisk test. Automatiske værktøjer finder kun en del af de
mulige barrierer; de erstatter ikke manuel test eller test med hjælpemidler.

## Feedback og kontaktoplysninger

Er du stødt på en barriere, eller har du brug for oplysninger i et tilgængeligt format?
Kontakt os:

- E-mail: {{ provider.email }}
{{#if provider.feedbackUrl}}
- Kontaktformular: {{ provider.feedbackUrl }}
{{/if}}
{{#if provider.phone}}
- Telefon: {{ provider.phone }}
{{/if}}
{{#if provider.address}}
- Adresse: {{ provider.address }}
{{/if}}

Vi bestræber os på at svare hurtigst muligt.

## Klageadgang

Hvis du ikke er tilfreds med vores svar, kan du henvende dig til Sikkerhedsstyrelsen, som
fører tilsyn med e-handelstjenester og forbrugerorienterede banktjenester efter loven.
Tilsynet i Danmark er fordelt på flere myndigheder: med elektroniske
kommunikationstjenester fører Energistyrelsen for eksempel tilsyn.

Sikkerhedsstyrelsen
https://www.sik.dk

Offentlige myndigheders websteder og mobilapplikationer er omfattet af en anden lov, som
kræver en særskilt tilgængelighedserklæring. Dette dokument erstatter ikke den.

---

Denne erklæring er udarbejdet med eaa-kit og er ikke juridisk rådgivning. Gennemgå den, før
den offentliggøres, og få den vurderet af en jurist, hvis du er i tvivl.
