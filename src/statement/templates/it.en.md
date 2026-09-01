# Accessibility Statement

{{ provider.legalName }} is committed to making the website {{ site.name }} accessible in
accordance with Legislative Decree 82 of 27 May 2022, which transposes Directive (EU)
2019/882 (the European Accessibility Act) into Italian law and amends Law 4 of 9 January
2004 (the Stanca Act). Its provisions apply from 28 June 2025.

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
{{#if pageList}}
  Pages affected: {{ pageList }}{{#if hasMorePages}} and {{ morePages }} more{{/if}}
{{/if}}
{{#if isDisproportionateBurden}}
  Reason: disproportionate burden.
{{/if}}
{{#if isOutOfScope}}
  Reason: the content falls outside the scope of Legislative Decree 82/2022.
{{/if}}
{{#if isFixPlanned}}
  Reason: the barrier is known and is being addressed.
{{/if}}
{{#if remedyByFormatted}}
  Expected to be resolved by: {{ remedyByFormatted }}
{{/if}}
{{#if isFromAudit}}
  Detected by automated testing (axe-core, rule {{ ruleId }}); describe it in your own words.
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

{{#if audit.isSinglePage}}
The automated test run of {{ audit.checkedOnFormatted }} covered one page of this website.
{{/if}}
{{#if audit.isMultiPage}}
The automated test run of {{ audit.checkedOnFormatted }} covered {{ audit.pages }}
pages of this website.
{{/if}}
{{#if audit.needsReviewIsSingle}}
One further rule check requires a manual decision.
{{/if}}
{{#if audit.needsReviewIsPlural}}
{{ audit.needsReview }} further rule checks require a manual decision.
{{/if}}
{{#if audit.notEvaluatedIsSingle}}
One rule check could not be decided by the tool that was used; it is not reported as met.
{{/if}}
{{#if audit.notEvaluatedIsPlural}}
{{ audit.notEvaluated }} rule checks could not be decided by the tool that was used; they
are not reported as met.
{{/if}}
{{#if hasAudit}}

{{/if}}
The assessment relies in part on automated testing. Automated tools detect only a subset
of possible barriers; they are not a substitute for manual testing or for testing with
assistive technologies.

## Feedback and contact

Found a barrier, or need information in an accessible format? Please get in touch:

- Email: {{ provider.email }}
{{#if provider.feedbackUrl}}
- Contact form: {{ provider.feedbackUrl }}
{{/if}}
{{#if provider.phone}}
- Phone: {{ provider.phone }}
{{/if}}
{{#if provider.address}}
- Address: {{ provider.address }}
{{/if}}

We aim to respond to your feedback promptly.

## Enforcement procedure

If you are not satisfied with our response, you can report the barrier to the Agency for
Digital Italy (AgID), the authority supervising the accessibility of services within the
scope of Legislative Decree 82/2022.

Agenzia per l'Italia digitale
https://www.agid.gov.it

Private providers of public-facing services whose average turnover over the last three
years exceeds €500 million publish and update an accessibility declaration on AgID's own
model, by 23 September each year. This document does not stand in for that declaration.

---

This statement was generated with eaa-kit and is not legal advice. Review it before
publishing, and have it checked by a lawyer if in doubt.
