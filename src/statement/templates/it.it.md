# Dichiarazione di accessibilità

{{ provider.legalName }} si impegna a rendere accessibile il sito {{ site.name }} in
conformità al decreto legislativo 27 maggio 2022, n. 82, che recepisce la direttiva (UE)
2019/882 (European Accessibility Act) e modifica la legge 9 gennaio 2004, n. 4 (legge
Stanca). Le relative disposizioni si applicano dal 28 giugno 2025.

Questa dichiarazione di accessibilità si riferisce a {{ site.url }}.

## Stato di conformità

{{#if compliance.isCompliant}}
Questo sito è pienamente conforme a {{ compliance.standard }}.
{{/if}}
{{#if compliance.isPartiallyCompliant}}
Questo sito è parzialmente conforme a {{ compliance.standard }}. I contenuti elencati nella
sezione seguente non sono accessibili, per i motivi indicati.
{{/if}}
{{#if compliance.isNonCompliant}}
Questo sito non è conforme a {{ compliance.standard }}. I contenuti elencati nella sezione
seguente non sono accessibili, per i motivi indicati.
{{/if}}

## Contenuti non accessibili

{{#if hasKnownIssues}}
{{#each compliance.knownIssues}}
- {{ description }}
{{#if standards}}
  Requisito interessato: {{ standards }}
{{/if}}
{{#if pageList}}
  Pagine interessate: {{ pageList }}{{#if hasMorePages}} e altre {{ morePages }}{{/if}}
{{/if}}
{{#if isDisproportionateBurden}}
  Motivo: onere sproporzionato.
{{/if}}
{{#if isOutOfScope}}
  Motivo: il contenuto non rientra nell'ambito di applicazione del d.lgs. 82/2022.
{{/if}}
{{#if isFixPlanned}}
  Motivo: la barriera è nota ed è in corso di correzione.
{{/if}}
{{#if remedyByFormatted}}
  Correzione prevista entro il: {{ remedyByFormatted }}
{{/if}}
{{#if isFromAudit}}
  Rilevato da un test automatico (axe-core, regola {{ ruleId }}); da riformulare con parole proprie.
{{/if}}
{{/each}}
{{/if}}
{{#if hasNoKnownIssues}}
Al momento della valutazione non risultavano contenuti non accessibili.
{{/if}}

## Redazione della presente dichiarazione

Questa dichiarazione è stata redatta il {{ compliance.assessedOnFormatted }}.

{{#if compliance.isSelfAssessment}}
Si basa su un'autovalutazione svolta da {{ provider.legalName }}.
{{/if}}
{{#if compliance.isExternalAudit}}
Si basa su una valutazione svolta da terzi.
{{/if}}

{{#if audit.isSinglePage}}
Il test automatico del {{ audit.checkedOnFormatted }} ha riguardato una pagina di questo
sito.
{{/if}}
{{#if audit.isMultiPage}}
Il test automatico del {{ audit.checkedOnFormatted }} ha riguardato {{ audit.pages }}
pagine di questo sito.
{{/if}}
{{#if audit.needsReviewIsSingle}}
Un'ulteriore verifica di regola richiede una valutazione manuale.
{{/if}}
{{#if audit.needsReviewIsPlural}}
Altre {{ audit.needsReview }} verifiche di regole richiedono una valutazione manuale.
{{/if}}
{{#if audit.notEvaluatedIsSingle}}
Per una verifica di regola lo strumento utilizzato non ha raggiunto un esito; non viene
presentata come soddisfatta.
{{/if}}
{{#if audit.notEvaluatedIsPlural}}
Per {{ audit.notEvaluated }} verifiche di regole lo strumento utilizzato non ha raggiunto
un esito; non vengono presentate come soddisfatte.
{{/if}}
{{#if hasAudit}}

{{/if}}
La valutazione si basa anche su test automatici. Gli strumenti automatici rilevano solo una
parte delle barriere possibili; non sostituiscono né una verifica manuale né una verifica
con tecnologie assistive.

## Riscontri e contatti

Ha incontrato una barriera, o le serve un'informazione in forma accessibile? Ci scriva:

- E-mail: {{ provider.email }}
{{#if provider.feedbackUrl}}
- Modulo di contatto: {{ provider.feedbackUrl }}
{{/if}}
{{#if provider.phone}}
- Telefono: {{ provider.phone }}
{{/if}}
{{#if provider.address}}
- Indirizzo: {{ provider.address }}
{{/if}}

Ci impegniamo a rispondere in tempi brevi.

## Procedura di attuazione

Se la risposta non è soddisfacente, può segnalare la barriera all'Agenzia per l'Italia
digitale (AgID), autorità di vigilanza sull'accessibilità dei servizi che rientrano
nell'ambito del d.lgs. 82/2022.

Agenzia per l'Italia digitale
https://www.agid.gov.it

I soggetti privati che offrono servizi al pubblico con un fatturato medio, negli ultimi tre
anni di attività, superiore a 500 milioni di euro pubblicano e aggiornano ogni anno, entro
il 23 settembre, una dichiarazione di accessibilità secondo il modello AgID. Questo
documento non sostituisce quella dichiarazione.

---

Questa dichiarazione è stata generata con eaa-kit e non costituisce consulenza legale. La
rilegga prima di pubblicarla e, in caso di dubbio, la faccia verificare da un legale.
