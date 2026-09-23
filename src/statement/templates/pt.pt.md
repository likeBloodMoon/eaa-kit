# Declaração de Acessibilidade

{{ provider.legalName }} compromete-se a tornar o sítio web {{ site.name }} acessível, nos
termos do Decreto-Lei n.º 82/2022, de 6 de dezembro, que transpõe para a ordem jurídica
portuguesa a Diretiva (UE) 2019/882 (Ato Europeu da Acessibilidade). As suas obrigações
relativas a produtos e serviços aplicam-se desde 28 de junho de 2025.

A presente declaração de acessibilidade aplica-se a {{ site.url }}.

## Estado de conformidade

{{#if compliance.isCompliant}}
Este sítio web está totalmente conforme com {{ compliance.standard }}.
{{/if}}
{{#if compliance.isPartiallyCompliant}}
Este sítio web está parcialmente conforme com {{ compliance.standard }}. Os conteúdos
indicados abaixo não são acessíveis, pelos motivos apresentados.
{{/if}}
{{#if compliance.isNonCompliant}}
Este sítio web não está conforme com {{ compliance.standard }}. Os conteúdos indicados
abaixo não são acessíveis, pelos motivos apresentados.
{{/if}}

## Conteúdos não acessíveis

{{#if hasKnownIssues}}
{{#each compliance.knownIssues}}
- {{ description }}
{{#if standards}}
  Requisito afetado: {{ standards }}
{{/if}}
{{#if pageList}}
  Páginas afetadas: {{ pageList }}{{#if hasMorePages}} e mais {{ morePages }}{{/if}}
{{/if}}
{{#if isDisproportionateBurden}}
  Motivo: encargo desproporcionado.
{{/if}}
{{#if isOutOfScope}}
  Motivo: o conteúdo não se enquadra no âmbito de aplicação deste decreto-lei.
{{/if}}
{{#if isFixPlanned}}
  Motivo: a barreira é conhecida e está a ser corrigida.
{{/if}}
{{#if remedyByFormatted}}
  Correção prevista até: {{ remedyByFormatted }}
{{/if}}
{{#if isFromAudit}}
  Detetado por um teste automático (axe-core, regra {{ ruleId }}); descreva-o por palavras suas.
{{/if}}
{{/each}}
{{/if}}
{{#if hasNoKnownIssues}}
No momento da avaliação não era conhecido nenhum conteúdo não acessível.
{{/if}}

## Elaboração desta declaração

A presente declaração foi elaborada em {{ compliance.assessedOnFormatted }}.

{{#if compliance.isSelfAssessment}}
Baseia-se numa autoavaliação realizada por {{ provider.legalName }}.
{{/if}}
{{#if compliance.isExternalAudit}}
Baseia-se numa avaliação realizada por terceiros.
{{/if}}

{{#if review.isSingle}}
Um dos {{ review.total }} critérios de sucesso das WCAG 2.2 (níveis A e AA) foi verificado
manualmente.
{{/if}}
{{#if review.isPlural}}
{{ review.answered }} dos {{ review.total }} critérios de sucesso das WCAG 2.2 (níveis A e
AA) foram verificados manualmente.
{{/if}}
{{#if review.hasDate}}
A mais recente dessas verificações manuais foi registada em {{ review.checkedOnFormatted }}.
{{/if}}
{{#if hasReview}}

{{/if}}
{{#if audit.isSinglePage}}
O teste automático de {{ audit.checkedOnFormatted }} abrangeu uma página deste sítio web.
{{/if}}
{{#if audit.isMultiPage}}
O teste automático de {{ audit.checkedOnFormatted }} abrangeu {{ audit.pages }} páginas
deste sítio web.
{{/if}}
{{#if audit.needsReviewIsSingle}}
Uma outra verificação de regra requer uma decisão humana.
{{/if}}
{{#if audit.needsReviewIsPlural}}
{{ audit.needsReview }} outras verificações de regras requerem uma decisão humana.
{{/if}}
{{#if audit.notEvaluatedIsSingle}}
Uma verificação de regra não pôde ser decidida pela ferramenta utilizada; não é apresentada
como cumprida.
{{/if}}
{{#if audit.notEvaluatedIsPlural}}
{{ audit.notEvaluated }} verificações de regras não puderam ser decididas pela ferramenta
utilizada; não são apresentadas como cumpridas.
{{/if}}
{{#if hasAudit}}

{{/if}}
A avaliação baseia-se em parte em testes automáticos. As ferramentas automáticas detetam
apenas uma parte das barreiras possíveis; não substituem testes manuais nem testes com
tecnologias de apoio.

## Comentários e contactos

Encontrou uma barreira ou precisa de informação num formato acessível? Contacte-nos:

- Correio eletrónico: {{ provider.email }}
{{#if provider.feedbackUrl}}
- Formulário de contacto: {{ provider.feedbackUrl }}
{{/if}}
{{#if provider.phone}}
- Telefone: {{ provider.phone }}
{{/if}}
{{#if provider.address}}
- Morada: {{ provider.address }}
{{/if}}

Procuramos responder com a maior brevidade possível.

## Procedimento de reclamação

Se não ficar satisfeito com a nossa resposta, pode apresentar uma reclamação à entidade
fiscalizadora competente. A fiscalização está repartida por várias entidades: para os
serviços de comércio eletrónico é a Autoridade Nacional de Comunicações (ANACOM), e os
serviços bancários, por exemplo, são fiscalizados pelo Banco de Portugal. As entidades
fiscalizadoras comunicam os produtos e serviços que não cumprem os requisitos de
acessibilidade ao Instituto Nacional para a Reabilitação (INR, I.P.).

Autoridade Nacional de Comunicações (ANACOM)
https://www.anacom.pt

Os sítios web e as aplicações móveis dos organismos do setor público estão sujeitos a um
regime próprio, que prevê a sua própria declaração de acessibilidade. O presente documento
não a substitui.

---

Esta declaração foi gerada com o eaa-kit e não constitui aconselhamento jurídico. Reveja-a
antes de a publicar e, em caso de dúvida, peça a um jurista que a verifique.
