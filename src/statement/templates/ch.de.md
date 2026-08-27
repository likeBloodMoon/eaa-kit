# Erklärung zur Barrierefreiheit

{{ provider.legalName }} ist bemüht, die Website {{ site.name }} barrierefrei zugänglich
zu machen. Massgebend sind das Bundesgesetz über die Beseitigung von Benachteiligungen von
Menschen mit Behinderungen (Behindertengleichstellungsgesetz, BehiG, SR 151.3) und der
Accessibility Standard eCH-0059.

Die Schweiz ist nicht Mitglied der EU. Die Richtlinie (EU) 2019/882 (European
Accessibility Act) gilt hier nicht unmittelbar. Wer Produkte oder Dienstleistungen in der
EU anbietet, kann ihr dennoch unterliegen.

Diese Erklärung zur Barrierefreiheit gilt für {{ site.url }}.

## Stand der Vereinbarkeit mit den Anforderungen

{{#if compliance.isCompliant}}
Diese Website ist mit {{ compliance.standard }} vollständig vereinbar.
{{/if}}
{{#if compliance.isPartiallyCompliant}}
Diese Website ist mit {{ compliance.standard }} teilweise vereinbar. Die im folgenden
Abschnitt aufgeführten Inhalte sind aus den jeweils genannten Gründen nicht barrierefrei.
{{/if}}
{{#if compliance.isNonCompliant}}
Diese Website ist mit {{ compliance.standard }} nicht vereinbar. Die im folgenden Abschnitt
aufgeführten Inhalte sind aus den jeweils genannten Gründen nicht barrierefrei.
{{/if}}

## Nicht barrierefreie Inhalte

{{#if hasKnownIssues}}
{{#each compliance.knownIssues}}
- {{ description }}
{{#if standards}}
  Betroffene Anforderung: {{ standards }}
{{/if}}
{{#if pageList}}
  Betroffene Seiten: {{ pageList }}{{#if hasMorePages}} und {{ morePages }} weitere{{/if}}
{{/if}}
{{#if isDisproportionateBurden}}
  Grund: unverhältnismäßige Belastung.
{{/if}}
{{#if isOutOfScope}}
  Grund: der Inhalt fällt nicht in den Anwendungsbereich des BehiG.
{{/if}}
{{#if isFixPlanned}}
  Grund: die Barriere ist bekannt und wird behoben.
{{/if}}
{{#if remedyByFormatted}}
  Geplante Behebung bis: {{ remedyByFormatted }}
{{/if}}
{{#if isFromAudit}}
  Automatisiert erkannt (axe-core, Regel {{ ruleId }}); bitte in eigenen Worten beschreiben.
{{/if}}
{{/each}}
{{/if}}
{{#if hasNoKnownIssues}}
Zum Zeitpunkt der Prüfung sind keine nicht barrierefreien Inhalte bekannt.
{{/if}}

## Erstellung dieser Erklärung

Diese Erklärung wurde am {{ compliance.assessedOnFormatted }} erstellt.

{{#if compliance.isSelfAssessment}}
Grundlage ist eine Selbstbewertung durch {{ provider.legalName }}.
{{/if}}
{{#if compliance.isExternalAudit}}
Grundlage ist eine Prüfung durch Dritte.
{{/if}}

{{#if audit.isSinglePage}}
Die automatisierte Prüfung vom {{ audit.checkedOnFormatted }} umfasste eine Seite dieser
Website.
{{/if}}
{{#if audit.isMultiPage}}
Die automatisierte Prüfung vom {{ audit.checkedOnFormatted }} umfasste {{ audit.pages }}
Seiten dieser Website.
{{/if}}
{{#if audit.needsReviewIsSingle}}
Bei einer weiteren Regelprüfung ist eine manuelle Beurteilung erforderlich.
{{/if}}
{{#if audit.needsReviewIsPlural}}
Bei {{ audit.needsReview }} weiteren Regelprüfungen ist eine manuelle Beurteilung
erforderlich.
{{/if}}
{{#if audit.notEvaluatedIsSingle}}
Bei einer Regelprüfung erreichte das verwendete Werkzeug kein Ergebnis; sie wird nicht als
erfüllt ausgewiesen.
{{/if}}
{{#if audit.notEvaluatedIsPlural}}
Bei {{ audit.notEvaluated }} Regelprüfungen erreichte das verwendete Werkzeug kein
Ergebnis; sie werden nicht als erfüllt ausgewiesen.
{{/if}}
{{#if hasAudit}}

{{/if}}
Die Bewertung stützt sich unter anderem auf eine automatisierte Prüfung. Automatisierte
Werkzeuge erkennen nur einen Teil der möglichen Barrieren; sie ersetzen keine manuelle
Prüfung und keine Prüfung mit assistiven Technologien.

## Feedback und Kontaktangaben

Sie haben eine Barriere gefunden oder benötigen Informationen in einer barrierefreien
Form? Melden Sie sich bitte bei uns:

- E-Mail: {{ provider.email }}
{{#if provider.feedbackUrl}}
- Kontaktformular: {{ provider.feedbackUrl }}
{{/if}}
{{#if provider.phone}}
- Telefon: {{ provider.phone }}
{{/if}}
{{#if provider.address}}
- Anschrift: {{ provider.address }}
{{/if}}

Wir bemühen uns, Ihre Rückmeldung zeitnah zu beantworten.

## Beschwerdeverfahren

Die Schweiz kennt für die Websites privater Anbieter keine Marktüberwachungsstelle, an
die eine Beschwerde gerichtet werden könnte.

Wenn Sie mit unserer Antwort nicht zufrieden sind, stehen Ihnen die Rechtsansprüche des
BehiG offen. Wer durch eine öffentlich angebotene Dienstleistung benachteiligt wird, kann
nach Artikel 8 BehiG das Gericht anrufen; Behindertenorganisationen können nach Artikel 9
BehiG in eigenem Namen klagen.

Allgemeine Auskünfte zur Gleichstellung von Menschen mit Behinderungen erteilt das
Eidgenössische Büro für die Gleichstellung von Menschen mit Behinderungen (EBGB).

Eidgenössisches Büro für die Gleichstellung von Menschen mit Behinderungen (EBGB)
https://www.ebgb.admin.ch

---

Diese Erklärung wurde mit eaa-kit erstellt und ist keine Rechtsberatung. Prüfen Sie den
Inhalt vor der Veröffentlichung und lassen Sie ihn im Zweifel rechtlich prüfen.
