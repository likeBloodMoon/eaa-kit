# Erklärung zur Barrierefreiheit

{{ provider.legalName }} ist bemüht, die Website {{ site.name }} im Einklang mit dem
Wirtschaftsgesetzbuch in der durch das Gesetz vom 5. November 2023 geänderten Fassung
barrierefrei zugänglich zu machen. Mit diesem Gesetz wird die Richtlinie (EU) 2019/882
(European Accessibility Act) für Dienstleistungen im elektronischen Geschäftsverkehr und
Bankdienstleistungen für Verbraucher in belgisches Recht umgesetzt. Diese Pflichten gelten
seit dem 28. Juni 2025.

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
  Grund: der Inhalt fällt nicht in den Anwendungsbereich dieser Pflichten.
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

{{#if review.isSingle}}
Eines der {{ review.total }} Erfolgskriterien der WCAG 2.2 (Stufen A und AA) wurde manuell
geprüft.
{{/if}}
{{#if review.isPlural}}
{{ review.answered }} der {{ review.total }} Erfolgskriterien der WCAG 2.2 (Stufen A und AA)
wurden manuell geprüft.
{{/if}}
{{#if review.hasDate}}
Die jüngste dieser manuellen Prüfungen erfolgte am {{ review.checkedOnFormatted }}.
{{/if}}
{{#if hasReview}}

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

Wenn Sie mit unserer Antwort nicht zufrieden sind, können Sie das Problem dem FÖD Wirtschaft
melden, dessen Generaldirektion Wirtschaftsinspektion die Einhaltung dieser Pflichten durch
Dienstleistungen im elektronischen Geschäftsverkehr überwacht.

FÖD Wirtschaft, K.M.B., Mittelstand und Energie
https://economie.fgov.be

Die Aufsicht ist in Belgien aufgeteilt: Für andere von der Richtlinie erfasste
Dienstleistungen, etwa die elektronische Kommunikation, sind andere Behörden zuständig.
Websites und mobile Anwendungen öffentlicher Stellen unterliegen einer eigenen Regelung mit
einer eigenen Erklärung zur Barrierefreiheit; dieses Dokument ersetzt sie nicht.

---

Diese Erklärung wurde mit eaa-kit erstellt und ist keine Rechtsberatung. Prüfen Sie den
Inhalt vor der Veröffentlichung und lassen Sie ihn im Zweifel rechtlich prüfen.
