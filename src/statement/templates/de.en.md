# Accessibility Statement

{{ provider.legalName }} is committed to making the website {{ site.name }} accessible in
accordance with the German Accessibility Strengthening Act
(Barrierefreiheitsstärkungsgesetz, BFSG) and its implementing regulation (BFSGV), which
transpose Directive (EU) 2019/882 (the European Accessibility Act) into German law.

This accessibility statement applies to {{ site.url }}.

## Compliance status

{{#if compliance.isCompliant}}
This website is fully compliant with {{ compliance.standard }}.
{{/if}}
{{#if compliance.isPartiallyCompliant}}
This website is partially compliant with {{ compliance.standard }}. The content listed in
the following section is not accessible, for the reasons given.
{{/if}}
{{#if compliance.isNonCompliant}}
This website is not compliant with {{ compliance.standard }}. The content listed in the
following section is not accessible, for the reasons given.
{{/if}}

## Non-accessible content

{{#if hasKnownIssues}}
{{#each compliance.knownIssues}}
- {{ description }}
{{#if standards}}
  Requirement affected: {{ standards }}
{{/if}}
{{#if isDisproportionateBurden}}
  Reason: disproportionate burden.
{{/if}}
{{#if isOutOfScope}}
  Reason: the content falls outside the scope of the BFSG.
{{/if}}
{{#if isFixPlanned}}
  Reason: the barrier is known and is being addressed.
{{/if}}
{{#if remedyByFormatted}}
  Expected to be resolved by: {{ remedyByFormatted }}
{{/if}}
{{/each}}
{{/if}}
{{#if hasNoKnownIssues}}
No non-accessible content was known at the time of assessment.
{{/if}}

## Preparation of this statement

This statement was prepared on {{ compliance.assessedOnFormatted }}.

{{#if compliance.isSelfAssessment}}
It is based on a self-assessment carried out by {{ provider.legalName }}.
{{/if}}
{{#if compliance.isExternalAudit}}
It is based on an assessment carried out by a third party.
{{/if}}

The assessment relies in part on automated testing. Automated tools detect only a subset
of possible barriers; they are not a substitute for manual testing or for testing with
assistive technologies.

## Feedback and contact

Found a barrier, or need information in an accessible format? Please get in touch:

- Email: {{ provider.email }}
{{#if provider.phone}}
- Phone: {{ provider.phone }}
{{/if}}
{{#if provider.address}}
- Address: {{ provider.address }}
{{/if}}

We aim to respond to your feedback promptly.

## Enforcement procedure

If you are not satisfied with our response, you can contact the market surveillance
authority for the accessibility of products and services (Marktüberwachungsstelle der
Länder für die Barrierefreiheit von Produkten und Dienstleistungen, MLBF), which is
responsible under the BFSG.

Marktüberwachungsstelle der Länder für die Barrierefreiheit von Produkten und
Dienstleistungen (MLBF)
https://www.marktueberwachung-barrierefreiheit.de

---

This statement was generated with eaa-kit and is not legal advice. Review it before
publishing, and have it checked by a lawyer if in doubt.
