# Prohlášení o přístupnosti

{{ provider.legalName }} usiluje o to, aby webové stránky {{ site.name }} byly přístupné v
souladu se zákonem č. 424/2023 Sb., o požadavcích na přístupnost některých výrobků a služeb,
kterým se do českého práva provádí směrnice (EU) 2019/882 (evropský akt o přístupnosti).
Požadavky zákona se uplatňují od 28. června 2025.

Toto prohlášení o přístupnosti se vztahuje na {{ site.url }}.

## Stav souladu

{{#if compliance.isCompliant}}
Tyto webové stránky jsou plně v souladu s normou {{ compliance.standard }}.
{{/if}}
{{#if compliance.isPartiallyCompliant}}
Tyto webové stránky jsou částečně v souladu s normou {{ compliance.standard }}. Níže uvedený
obsah není přístupný z uvedených důvodů.
{{/if}}
{{#if compliance.isNonCompliant}}
Tyto webové stránky nejsou v souladu s normou {{ compliance.standard }}. Níže uvedený obsah
není přístupný z uvedených důvodů.
{{/if}}

## Nepřístupný obsah

{{#if hasKnownIssues}}
{{#each compliance.knownIssues}}
- {{ description }}
{{#if standards}}
  Dotčený požadavek: {{ standards }}
{{/if}}
{{#if pageList}}
  Dotčené stránky: {{ pageList }}{{#if hasMorePages}} a další (počet: {{ morePages }}){{/if}}
{{/if}}
{{#if isDisproportionateBurden}}
  Důvod: nepřiměřená zátěž.
{{/if}}
{{#if isOutOfScope}}
  Důvod: obsah nespadá do působnosti zákona.
{{/if}}
{{#if isFixPlanned}}
  Důvod: nedostatek je známý a odstraňuje se.
{{/if}}
{{#if remedyByFormatted}}
  Předpokládané odstranění do: {{ remedyByFormatted }}
{{/if}}
{{#if isFromAudit}}
  Zjištěno automatizovaným testem (axe-core, pravidlo {{ ruleId }}); popište vlastními slovy.
{{/if}}
{{/each}}
{{/if}}
{{#if hasNoKnownIssues}}
V době posouzení nebyl znám žádný nepřístupný obsah.
{{/if}}

## Vypracování tohoto prohlášení

Toto prohlášení bylo vypracováno dne {{ compliance.assessedOnFormatted }}.

{{#if compliance.isSelfAssessment}}
Vychází z vlastního posouzení, které provedl subjekt {{ provider.legalName }}.
{{/if}}
{{#if compliance.isExternalAudit}}
Vychází z posouzení provedeného třetí stranou.
{{/if}}

{{#if review.isSingle}}
Jedno z {{ review.total }} kritérií úspěšnosti WCAG 2.2 (úrovně A a AA) bylo ověřeno ručně.
{{/if}}
{{#if review.isPlural}}
Počet kritérií úspěšnosti WCAG 2.2 (úrovně A a AA) ověřených ručně: {{ review.answered }} z
{{ review.total }}.
{{/if}}
{{#if review.hasDate}}
Poslední z těchto ručních ověření bylo zaznamenáno dne {{ review.checkedOnFormatted }}.
{{/if}}
{{#if hasReview}}

{{/if}}
{{#if audit.isSinglePage}}
Automatizovaný test ze dne {{ audit.checkedOnFormatted }} zahrnul jednu stránku tohoto webu.
{{/if}}
{{#if audit.isMultiPage}}
Automatizovaný test ze dne {{ audit.checkedOnFormatted }} zahrnul následující počet stránek
tohoto webu: {{ audit.pages }}.
{{/if}}
{{#if audit.needsReviewIsSingle}}
Jedna další kontrola pravidla vyžaduje posouzení člověkem.
{{/if}}
{{#if audit.needsReviewIsPlural}}
Počet dalších kontrol pravidel, které vyžadují posouzení člověkem: {{ audit.needsReview }}.
{{/if}}
{{#if audit.notEvaluatedIsSingle}}
U jedné kontroly pravidla použitý nástroj nedospěl k výsledku; není uváděna jako splněná.
{{/if}}
{{#if audit.notEvaluatedIsPlural}}
Počet kontrol pravidel, u nichž použitý nástroj nedospěl k výsledku: {{ audit.notEvaluated
}}; nejsou uváděny jako splněné.
{{/if}}
{{#if hasAudit}}

{{/if}}
Posouzení se zčásti opírá o automatizované testování. Automatizované nástroje odhalí jen
část možných bariér; nenahrazují ruční testování ani testování s asistivními technologiemi.

## Zpětná vazba a kontaktní údaje

Narazili jste na bariéru, nebo potřebujete informace v přístupné podobě? Kontaktujte nás:

- E-mail: {{ provider.email }}
{{#if provider.feedbackUrl}}
- Kontaktní formulář: {{ provider.feedbackUrl }}
{{/if}}
{{#if provider.phone}}
- Telefon: {{ provider.phone }}
{{/if}}
{{#if provider.address}}
- Adresa: {{ provider.address }}
{{/if}}

Snažíme se odpovídat co nejdříve.

## Dozor

Pokud nejste s naší odpovědí spokojeni, můžete se obrátit na Českou obchodní inspekci (ČOI),
která vykonává dozor nad službami elektronického obchodování. Dozor nad některými dalšími
službami, například nad službami elektronických komunikací, vykonávají jiné orgány.

Česká obchodní inspekce (ČOI)
https://coi.gov.cz

Webové stránky a mobilní aplikace subjektů veřejného sektoru upravuje jiný zákon, který
vyžaduje vlastní prohlášení o přístupnosti. Tento dokument je nenahrazuje.

---

Toto prohlášení bylo vytvořeno nástrojem eaa-kit a nepředstavuje právní radu. Před
zveřejněním je zkontrolujte, a v případě pochybností je nechte posoudit právníkem.
