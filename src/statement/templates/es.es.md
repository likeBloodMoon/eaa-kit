# Declaración de accesibilidad

{{ provider.legalName }} se compromete a hacer accesible el sitio web {{ site.name }}
conforme a la Ley 11/2023, de 8 de mayo, que traspone al ordenamiento español la Directiva
(UE) 2019/882 (European Accessibility Act). Sus obligaciones sobre productos y servicios
son aplicables desde el 28 de junio de 2025.

Esta declaración de accesibilidad se refiere a {{ site.url }}.

## Situación de cumplimiento

{{#if compliance.isCompliant}}
Este sitio web es plenamente conforme con {{ compliance.standard }}.
{{/if}}
{{#if compliance.isPartiallyCompliant}}
Este sitio web es parcialmente conforme con {{ compliance.standard }}. Los contenidos que
se enumeran a continuación no son accesibles, por los motivos indicados.
{{/if}}
{{#if compliance.isNonCompliant}}
Este sitio web no es conforme con {{ compliance.standard }}. Los contenidos que se enumeran
a continuación no son accesibles, por los motivos indicados.
{{/if}}

## Contenido no accesible

{{#if hasKnownIssues}}
{{#each compliance.knownIssues}}
- {{ description }}
{{#if standards}}
  Requisito afectado: {{ standards }}
{{/if}}
{{#if pageList}}
  Páginas afectadas: {{ pageList }}{{#if hasMorePages}} y {{ morePages }} más{{/if}}
{{/if}}
{{#if isDisproportionateBurden}}
  Motivo: carga desproporcionada.
{{/if}}
{{#if isOutOfScope}}
  Motivo: el contenido queda fuera del ámbito de aplicación de la Ley 11/2023.
{{/if}}
{{#if isFixPlanned}}
  Motivo: la barrera es conocida y está en vías de corrección.
{{/if}}
{{#if remedyByFormatted}}
  Corrección prevista antes del: {{ remedyByFormatted }}
{{/if}}
{{#if isFromAudit}}
  Detectado mediante análisis automático (axe-core, regla {{ ruleId }}); descríbalo con sus propias palabras.
{{/if}}
{{/each}}
{{/if}}
{{#if hasNoKnownIssues}}
En el momento de la evaluación no constaba contenido no accesible.
{{/if}}

## Preparación de la presente declaración

Esta declaración se preparó el {{ compliance.assessedOnFormatted }}.

{{#if compliance.isSelfAssessment}}
Se basa en una autoevaluación realizada por {{ provider.legalName }}.
{{/if}}
{{#if compliance.isExternalAudit}}
Se basa en una evaluación realizada por un tercero.
{{/if}}

{{#if audit.isSinglePage}}
El análisis automático del {{ audit.checkedOnFormatted }} abarcó una página de este sitio
web.
{{/if}}
{{#if audit.isMultiPage}}
El análisis automático del {{ audit.checkedOnFormatted }} abarcó {{ audit.pages }} páginas
de este sitio web.
{{/if}}
{{#if audit.needsReviewIsSingle}}
Otra comprobación de regla requiere una valoración manual.
{{/if}}
{{#if audit.needsReviewIsPlural}}
Otras {{ audit.needsReview }} comprobaciones de reglas requieren una valoración manual.
{{/if}}
{{#if audit.notEvaluatedIsSingle}}
En una comprobación de regla la herramienta empleada no alcanzó un resultado; no se
presenta como cumplida.
{{/if}}
{{#if audit.notEvaluatedIsPlural}}
En {{ audit.notEvaluated }} comprobaciones de reglas la herramienta empleada no alcanzó un
resultado; no se presentan como cumplidas.
{{/if}}
{{#if hasAudit}}

{{/if}}
La evaluación se apoya en parte en análisis automáticos. Las herramientas automáticas solo
detectan una parte de las barreras posibles; no sustituyen a una revisión manual ni a una
prueba con tecnologías de apoyo.

## Observaciones y datos de contacto

¿Ha encontrado una barrera, o necesita información en un formato accesible? Escríbanos:

- Correo electrónico: {{ provider.email }}
{{#if provider.feedbackUrl}}
- Formulario de contacto: {{ provider.feedbackUrl }}
{{/if}}
{{#if provider.phone}}
- Teléfono: {{ provider.phone }}
{{/if}}
{{#if provider.address}}
- Dirección: {{ provider.address }}
{{/if}}

Procuramos responder a su comunicación con prontitud.

## Procedimiento de aplicación

Si nuestra respuesta no le resulta satisfactoria, puede presentar una reclamación ante la
autoridad de vigilancia del mercado competente. La Ley 11/2023 reparte esa vigilancia entre
las administraciones competentes del Estado y de las comunidades autónomas, por lo que la
vía habitual para un servicio digital es el organismo de consumo de su comunidad autónoma.

Los sitios web y las aplicaciones móviles del sector público se rigen además por el Real
Decreto 1112/2018, que exige una declaración de accesibilidad de contenido propio. Este
documento no es esa declaración.

---

Esta declaración se ha generado con eaa-kit y no constituye asesoramiento jurídico.
Revísela antes de publicarla y, en caso de duda, sométala a revisión jurídica.
