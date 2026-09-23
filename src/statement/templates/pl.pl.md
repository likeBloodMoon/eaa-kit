# Deklaracja dostępności

{{ provider.legalName }} zobowiązuje się zapewnić dostępność strony internetowej
{{ site.name }} zgodnie z ustawą z dnia 26 kwietnia 2024 r. o zapewnianiu spełniania
wymagań dostępności niektórych produktów i usług przez podmioty gospodarcze
(Dz.U. 2024 poz. 731), która wdraża do prawa polskiego dyrektywę (UE) 2019/882
(Europejski akt o dostępności). Ustawa obowiązuje od 28 czerwca 2025 r.

Niniejsza deklaracja dostępności dotyczy strony {{ site.url }}.

## Status zgodności

{{#if compliance.isCompliant}}
Ta strona internetowa jest w pełni zgodna z {{ compliance.standard }}.
{{/if}}
{{#if compliance.isPartiallyCompliant}}
Ta strona internetowa jest częściowo zgodna z {{ compliance.standard }}. Treści wymienione
poniżej nie są dostępne z podanych przyczyn.
{{/if}}
{{#if compliance.isNonCompliant}}
Ta strona internetowa nie jest zgodna z {{ compliance.standard }}. Treści wymienione
poniżej nie są dostępne z podanych przyczyn.
{{/if}}

## Treści niedostępne

{{#if hasKnownIssues}}
{{#each compliance.knownIssues}}
- {{ description }}
{{#if standards}}
  Dotyczy wymagania: {{ standards }}
{{/if}}
{{#if pageList}}
  Dotyczy stron: {{ pageList }}{{#if hasMorePages}} oraz innych (liczba: {{ morePages }}){{/if}}
{{/if}}
{{#if isDisproportionateBurden}}
  Przyczyna: nieproporcjonalne obciążenie.
{{/if}}
{{#if isOutOfScope}}
  Przyczyna: treść nie jest objęta zakresem stosowania ustawy.
{{/if}}
{{#if isFixPlanned}}
  Przyczyna: bariera jest znana i trwa jej usuwanie.
{{/if}}
{{#if remedyByFormatted}}
  Przewidywany termin usunięcia: {{ remedyByFormatted }} r.
{{/if}}
{{#if isFromAudit}}
  Wykryto w teście automatycznym (axe-core, reguła {{ ruleId }}); opisz to własnymi słowami.
{{/if}}
{{/each}}
{{/if}}
{{#if hasNoKnownIssues}}
W chwili oceny nie były znane żadne treści niedostępne.
{{/if}}

## Sporządzenie deklaracji

Deklarację sporządzono dnia {{ compliance.assessedOnFormatted }} r.

{{#if compliance.isSelfAssessment}}
Deklaracja opiera się na samoocenie przeprowadzonej przez {{ provider.legalName }}.
{{/if}}
{{#if compliance.isExternalAudit}}
Deklaracja opiera się na ocenie przeprowadzonej przez podmiot zewnętrzny.
{{/if}}

{{#if review.isSingle}}
Jedno z {{ review.total }} kryteriów sukcesu WCAG 2.2 (poziomy A i AA) zostało sprawdzone
ręcznie.
{{/if}}
{{#if review.isPlural}}
Liczba kryteriów sukcesu WCAG 2.2 (poziomy A i AA) sprawdzonych ręcznie:
{{ review.answered }} z {{ review.total }}.
{{/if}}
{{#if review.hasDate}}
Ostatnie z tych ręcznych sprawdzeń odnotowano dnia {{ review.checkedOnFormatted }} r.
{{/if}}
{{#if hasReview}}

{{/if}}
{{#if audit.isSinglePage}}
Test automatyczny z dnia {{ audit.checkedOnFormatted }} r. objął jedną stronę tej witryny.
{{/if}}
{{#if audit.isMultiPage}}
Test automatyczny z dnia {{ audit.checkedOnFormatted }} r. objął następującą liczbę stron
tej witryny: {{ audit.pages }}.
{{/if}}
{{#if audit.needsReviewIsSingle}}
Jedna dalsza kontrola reguły wymaga oceny przez człowieka.
{{/if}}
{{#if audit.needsReviewIsPlural}}
Liczba dalszych kontroli reguł wymagających oceny przez człowieka: {{ audit.needsReview }}.
{{/if}}
{{#if audit.notEvaluatedIsSingle}}
Jednej kontroli reguły użyte narzędzie nie mogło rozstrzygnąć; nie jest ona przedstawiana
jako spełniona.
{{/if}}
{{#if audit.notEvaluatedIsPlural}}
Liczba kontroli reguł, których użyte narzędzie nie mogło rozstrzygnąć:
{{ audit.notEvaluated }}; nie są one przedstawiane jako spełnione.
{{/if}}
{{#if hasAudit}}

{{/if}}
Ocena opiera się częściowo na testach automatycznych. Narzędzia automatyczne wykrywają
tylko część możliwych barier; nie zastępują testów ręcznych ani testów z użyciem
technologii wspomagających.

## Informacje zwrotne i dane kontaktowe

Napotkali Państwo barierę lub potrzebują informacji w dostępnej formie? Prosimy o kontakt:

- E-mail: {{ provider.email }}
{{#if provider.feedbackUrl}}
- Formularz kontaktowy: {{ provider.feedbackUrl }}
{{/if}}
{{#if provider.phone}}
- Telefon: {{ provider.phone }}
{{/if}}
{{#if provider.address}}
- Adres: {{ provider.address }}
{{/if}}

Staramy się odpowiadać niezwłocznie.

## Zgłoszenie braku dostępności

Jeśli nie są Państwo zadowoleni z naszej odpowiedzi, mogą Państwo zgłosić brak dostępności
Prezesowi Zarządu Państwowego Funduszu Rehabilitacji Osób Niepełnosprawnych (PFRON). Prezes
Zarządu PFRON przyjmuje zgłoszenia dotyczące wszystkich produktów i usług objętych ustawą
i rozpatruje je sam albo przekazuje właściwemu organowi nadzoru rynku; dla usług handlu
elektronicznego jest nim minister właściwy do spraw informatyzacji.

Państwowy Fundusz Rehabilitacji Osób Niepełnosprawnych
https://www.pfron.org.pl

Strony internetowe i aplikacje mobilne podmiotów publicznych podlegają odrębnym przepisom,
które przewidują własną deklarację dostępności. Niniejszy dokument jej nie zastępuje.

---

Niniejsza deklaracja została wygenerowana za pomocą eaa-kit i nie stanowi porady prawnej.
Przed publikacją należy ją przejrzeć, a w razie wątpliwości skonsultować z prawnikiem.
