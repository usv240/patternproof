# Formative negative-review study

Status: problem-discovery evidence, not product validation
Manual access date: 2026-08-10

## Why this exists

We reviewed a deliberately constructed sample of public, low-rated consumer complaints about tailoring and alteration services. The purpose was to identify failure modes worth investigating while designing PatternProof. This study cannot estimate how common those failures are, establish what caused them, verify any allegation, or show that PatternProof prevents them.

The final corpus contains 108 complaints concerning 41 businesses across three city samples: Mumbai (40 complaints, 6 businesses), Bengaluru (28 complaints, 17 businesses), and Delhi (40 complaints, 18 businesses).

## Protocol

- Researchers manually visited public review pages on 2026-08-10. No scraper, API, automated collection, or bulk extraction was used.
- Sampling was purposive: we actively sought low-rated tailoring and alteration complaints that could reveal product-relevant failure modes. It was not random, exhaustive, or representative.
- A record was eligible when the page displayed a rating from 1.0 through 2.0 on a five-star scale, the text described a relevant tailoring or alteration experience, and there was enough text to identify a primary complaint. Fractional ratings inside that range, such as 1.2, were retained; ratings below 1.0 were excluded rather than relabelled.
- Each included complaint received one mutually exclusive primary code. Reviews can describe several problems, so this simplification records the dominant issue only.
- We retained only coded aggregates in this public note. Reviewer names, business names, exact review text, internal source URLs, and the individual record ledger are withheld.

## Codebook

| Primary code | Operational meaning |
| --- | --- |
| `EXPECTATION` | The delivered look, design, or requested outcome allegedly differed from what the customer expected, excluding complaints primarily about fit. |
| `FIT` | The primary allegation concerned sizing, measurements, comfort, or how the garment fit. |
| `DELAY` | The primary allegation concerned lateness, missed dates, or turnaround time. |
| `WORKMANSHIP` | The primary allegation concerned construction, finishing, or craft quality. |
| `FABRIC_DAMAGE` | The primary allegation concerned cutting, marking, staining, wasting, or otherwise damaging the customer's material. |
| `PRICE` | The primary allegation concerned charges, value, refunds, or payment. |
| `SERVICE` | The primary allegation concerned communication, conduct, support, or administration. |

## Results

### Primary-code counts by city

| City sample | Businesses | `EXPECTATION` | `FIT` | `DELAY` | `WORKMANSHIP` | `FABRIC_DAMAGE` | `PRICE` | `SERVICE` | Total |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Mumbai | 6 | 9 | 11 | 11 | 7 | 0 | 2 | 0 | 40 |
| Bengaluru | 17 | 3 | 7 | 2 | 2 | 7 | 3 | 4 | 28 |
| Delhi | 18 | 12 | 5 | 10 | 9 | 1 | 1 | 2 | 40 |
| **Total** | **41** | **24** | **23** | **23** | **18** | **8** | **6** | **6** | **108** |

### Aggregate distribution

| Primary code | Count | Share of constructed sample |
| --- | ---: | ---: |
| `EXPECTATION` | 24 | 22.2% |
| `FIT` | 23 | 21.3% |
| `DELAY` | 23 | 21.3% |
| `WORKMANSHIP` | 18 | 16.7% |
| `FABRIC_DAMAGE` | 8 | 7.4% |
| `PRICE` | 6 | 5.6% |
| `SERVICE` | 6 | 5.6% |
| **Total** | **108** | **100.0% before rounding** |

Because every complaint has one primary code, the thesis grouping `EXPECTATION` + `FABRIC_DAMAGE`, specified before coding, contains 32 of 108 records (29.6%). `EXPECTATION` is the reported outcome category most closely aligned with PatternProof's communication hypothesis; `FABRIC_DAMAGE` illustrates the stakes of irreversible work but is not something the product can guarantee against. This is a descriptive result inside this purposive negative-review sample, not a population prevalence estimate or a count of incidents that PatternProof could have prevented.

### Platform composition

| Public source type | Count |
| --- | ---: |
| Trustpilot | 37 |
| Public Google-review mirrors | 34 |
| WeddingWire | 23 |
| WedMeGood | 11 |
| JustDial | 2 |
| Tripadvisor | 1 |
| **Total** | **108** |

## Exclusions and quality controls

Candidates were excluded when the rating was above the threshold, not displayed on the individual review, or merely inferred from a page-level aggregate; when the text was missing or too vague to code; when the subject was not a relevant tailoring or alteration experience; or when a record was duplicate, spam-like, inaccessible, or otherwise not independently inspectable during collection. In particular, one Bengaluru candidate was excluded because its rating had been inferred from a lone-review aggregate rather than displayed on the review itself.

The arithmetic is internally reconciled: city totals sum to 108, business totals sum to 41, primary-code counts sum to 108, and platform counts sum to 108. Percentages are calculated against 108 and may not sum visually to exactly 100% after one-decimal rounding.

## Limitations

- This is a purposive sample of negative reviews, so it intentionally over-selects adverse experiences. It says nothing about the proportion of satisfied customers or the prevalence of any failure mode among all tailoring transactions.
- There is no inclusion denominator. We did not record a complete count of all reviews or candidates available on each platform, so selection rates cannot be calculated.
- One coder assigned the primary codes. There was no second independent coder and no inter-rater-reliability assessment.
- Platform design, search ranking, moderation, availability, and regional usage shape what was visible. Public Google-review mirrors may be incomplete, delayed, or detached from their original context.
- The city groups are not balanced panels. Mumbai is especially concentrated: 29 of its 40 records concern one global online service. A city label therefore describes the sampling bucket, not a representative local market.
- Reviews are self-reported allegations. We did not inspect transactions, garments, messages, refunds, business responses, or any other corroborating evidence.
- A single primary code compresses multi-issue narratives and depends on coder judgment.
- Historical public reviews may not describe a business's current practices.

## Ethical handling

Public availability does not remove the risk of amplifying an unverified allegation. This note therefore omits reviewer and business names, exact review text, source URLs, profile details, the record ledger, and any information unnecessary for aggregate interpretation. No finding should be used to rank businesses, accuse a person or business of wrongdoing, or contact a reviewer.

## Product interpretation

The 24 `EXPECTATION` records give the team a concrete reason to investigate clearer visual scope agreement. The eight `FABRIC_DAMAGE` records make the cost of irreversible work visible, but they do not show that a software checkpoint could have prevented the alleged damage. PatternProof is designed to create a shared visual brief, record approval state, and preserve an auditable pre-cut handoff. This study does not demonstrate that those features reduce disputes, rework, or material loss.

PatternProof does not solve fit, delay, workmanship, service, or price problems. It also cannot guarantee that expectation mismatches or fabric damage will be prevented. Those boundaries should remain explicit in the submission and demo.

A credible next step is a prospective pilot with consenting tailoring businesses and customers. Before deployment, the team should define outcomes such as brief comprehension, requested changes before cutting, rework, disputes, and user-reported confidence; preserve a denominator for all eligible orders; compare against the existing workflow; and have multiple coders assess qualitative outcomes. Until then, these results are formative problem-discovery evidence only.
