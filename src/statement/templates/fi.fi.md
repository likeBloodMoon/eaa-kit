# Saavutettavuusseloste

{{ provider.legalName }} pyrkii siihen, että verkkosivusto {{ site.name }} on saavutettava
lain digitaalisten palvelujen tarjoamisesta (306/2019) mukaisesti. Lakia on muutettu
direktiivin (EU) 2019/882 (esteettömyysdirektiivi) panemiseksi täytäntöön Suomessa.
Verkkokauppapalveluja koskevia saavutettavuusvaatimuksia sovelletaan 28.6.2025 alkaen.

Tämä saavutettavuusseloste koskee sivustoa {{ site.url }}.

## Vaatimustenmukaisuuden tila

{{#if compliance.isCompliant}}
Tämä verkkosivusto on kokonaan yhdenmukainen standardin {{ compliance.standard }} kanssa.
{{/if}}
{{#if compliance.isPartiallyCompliant}}
Tämä verkkosivusto on osittain yhdenmukainen standardin {{ compliance.standard }} kanssa.
Alla luetellut sisällöt eivät ole saavutettavia mainituista syistä.
{{/if}}
{{#if compliance.isNonCompliant}}
Tämä verkkosivusto ei ole yhdenmukainen standardin {{ compliance.standard }} kanssa. Alla
luetellut sisällöt eivät ole saavutettavia mainituista syistä.
{{/if}}

## Sisältö, joka ei ole saavutettavaa

{{#if hasKnownIssues}}
{{#each compliance.knownIssues}}
- {{ description }}
{{#if standards}}
  Koskee vaatimusta: {{ standards }}
{{/if}}
{{#if pageList}}
  Koskee sivuja: {{ pageList }}{{#if hasMorePages}} ja {{ morePages }} muuta{{/if}}
{{/if}}
{{#if isDisproportionateBurden}}
  Syy: kohtuuton rasite.
{{/if}}
{{#if isOutOfScope}}
  Syy: sisältö ei kuulu lain soveltamisalaan.
{{/if}}
{{#if isFixPlanned}}
  Syy: puute tiedetään ja sitä korjataan.
{{/if}}
{{#if remedyByFormatted}}
  Korjataan viimeistään: {{ remedyByFormatted }}
{{/if}}
{{#if isFromAudit}}
  Havaittu automaattisessa testauksessa (axe-core, sääntö {{ ruleId }}); kuvaa puute omin sanoin.
{{/if}}
{{/each}}
{{/if}}
{{#if hasNoKnownIssues}}
Arvioinnin aikaan ei ollut tiedossa sisältöä, joka ei olisi saavutettavaa.
{{/if}}

## Selosteen laatiminen

Tämä seloste on laadittu {{ compliance.assessedOnFormatted }}.

{{#if compliance.isSelfAssessment}}
Se perustuu itsearviointiin, jonka on tehnyt {{ provider.legalName }}.
{{/if}}
{{#if compliance.isExternalAudit}}
Se perustuu kolmannen osapuolen tekemään arviointiin.
{{/if}}

{{#if review.isSingle}}
Yksi WCAG 2.2:n {{ review.total }} onnistumiskriteeristä (tasot A ja AA) on tarkistettu
manuaalisesti.
{{/if}}
{{#if review.isPlural}}
Manuaalisesti on tarkistettu {{ review.answered }}/{{ review.total }} WCAG 2.2:n
onnistumiskriteeristä (tasot A ja AA).
{{/if}}
{{#if review.hasDate}}
Viimeisin näistä manuaalisista tarkistuksista kirjattiin {{ review.checkedOnFormatted }}.
{{/if}}
{{#if hasReview}}

{{/if}}
{{#if audit.isSinglePage}}
Automaattinen testaus {{ audit.checkedOnFormatted }} kattoi yhden sivun tältä sivustolta.
{{/if}}
{{#if audit.isMultiPage}}
Automaattinen testaus {{ audit.checkedOnFormatted }} kattoi {{ audit.pages }} sivua tältä
sivustolta.
{{/if}}
{{#if audit.needsReviewIsSingle}}
Yksi muu sääntötarkistus edellyttää ihmisen arviota.
{{/if}}
{{#if audit.needsReviewIsPlural}}
{{ audit.needsReview }} muuta sääntötarkistusta edellyttää ihmisen arviota.
{{/if}}
{{#if audit.notEvaluatedIsSingle}}
Käytetty työkalu ei pystynyt ratkaisemaan yhtä sääntötarkistusta; sitä ei esitetä
täyttyneenä.
{{/if}}
{{#if audit.notEvaluatedIsPlural}}
Käytetty työkalu ei pystynyt ratkaisemaan {{ audit.notEvaluated }} sääntötarkistusta; niitä
ei esitetä täyttyneinä.
{{/if}}
{{#if hasAudit}}

{{/if}}
Arviointi perustuu osittain automaattiseen testaukseen. Automaattiset työkalut löytävät vain
osan mahdollisista puutteista; ne eivät korvaa manuaalista testausta eikä testausta
avustavilla teknologioilla.

## Palaute ja yhteystiedot

Huomasitko saavutettavuuspuutteen, tai tarvitsetko tietoa saavutettavassa muodossa? Ota
yhteyttä:

- Sähköposti: {{ provider.email }}
{{#if provider.feedbackUrl}}
- Yhteydenottolomake: {{ provider.feedbackUrl }}
{{/if}}
{{#if provider.phone}}
- Puhelin: {{ provider.phone }}
{{/if}}
{{#if provider.address}}
- Osoite: {{ provider.address }}
{{/if}}

Pyrimme vastaamaan mahdollisimman pian.

## Valvontaviranomainen

Jos et ole tyytyväinen vastaukseemme, voit ottaa yhteyttä Liikenne- ja viestintävirasto
Traficomiin, joka valvoo digitaalisten palvelujen saavutettavuutta.

Liikenne- ja viestintävirasto Traficom
https://www.traficom.fi

Laissa on omat sisältövaatimuksensa julkisen sektorin toimijoiden saavutettavuusselosteille.
Tämä asiakirja ei korvaa sellaista selostetta.

---

Tämä seloste on laadittu eaa-kit-työkalulla, eikä se ole oikeudellista neuvontaa. Tarkista
se ennen julkaisua, ja pyydä epäselvissä tapauksissa juristin arvio.
