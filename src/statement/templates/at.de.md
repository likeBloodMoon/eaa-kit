# Erklärung zur Barrierefreiheit

{{ provider.legalName }} ist bemüht, die Website {{ site.name }} im Einklang mit dem
österreichischen Barrierefreiheitsgesetz (BaFG) barrierefrei zugänglich zu machen. Das
BaFG setzt die Richtlinie (EU) 2019/882 (European Accessibility Act) in österreichisches
Recht um.

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
{{#if isDisproportionateBurden}}
  Grund: unverhältnismäßige Belastung.
{{/if}}
{{#if isOutOfScope}}
  Grund: der Inhalt fällt nicht in den Anwendungsbereich des BaFG.
{{/if}}
{{#if isFixPlanned}}
  Grund: die Barriere ist bekannt und wird behoben.
{{/if}}
{{#if remedyByFormatted}}
  Geplante Behebung bis: {{ remedyByFormatted }}
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

Die Bewertung stützt sich unter anderem auf eine automatisierte Prüfung. Automatisierte
Werkzeuge erkennen nur einen Teil der möglichen Barrieren; sie ersetzen keine manuelle
Prüfung und keine Prüfung mit assistiven Technologien.

## Feedback und Kontaktangaben

Sie haben eine Barriere gefunden oder benötigen Informationen in einer barrierefreien
Form? Melden Sie sich bitte bei uns:

- E-Mail: {{ provider.email }}
{{#if provider.phone}}
- Telefon: {{ provider.phone }}
{{/if}}
{{#if provider.address}}
- Anschrift: {{ provider.address }}
{{/if}}

Wir bemühen uns, Ihre Rückmeldung zeitnah zu beantworten.

## Beschwerdeverfahren

Wenn Sie mit unserer Antwort nicht zufrieden sind, können Sie sich an das
Sozialministeriumservice wenden. Das Sozialministeriumservice ist in Österreich die für
die Marktüberwachung nach dem BaFG zuständige Stelle.

Sozialministeriumservice
https://www.sozialministeriumservice.at

---

Diese Erklärung wurde mit eaa-kit erstellt und ist keine Rechtsberatung. Prüfen Sie den
Inhalt vor der Veröffentlichung und lassen Sie ihn im Zweifel rechtlich prüfen.
