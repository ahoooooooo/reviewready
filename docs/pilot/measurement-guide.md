# Pilot measurement guide

Define the sample and terms before observing results. The goal is a small,
auditable record, not a favorable-looking metric.

## Required measurements

| Field                     | Definition                                                                                                                                                                               |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `setupMinutes`            | Whole minutes from beginning the documented setup to the first valid local or advisory report. Record external approval queues as friction rather than silently adding or removing them. |
| `evaluatedPullRequests`   | Eligible pull requests in the frozen sample that received a completed ReviewReady report.                                                                                                |
| `readyReports`            | Completed reports whose final ReviewReady result was ready.                                                                                                                              |
| `notReadyReports`         | Completed reports whose final result was not ready. Ready plus not-ready must equal evaluated.                                                                                           |
| `confirmedFalsePositives` | ReviewReady reported ready, but the authorized maintainer confirmed that evidence required by the frozen policy was actually missing.                                                    |
| `confirmedFalseNegatives` | ReviewReady reported not ready, but the authorized maintainer confirmed that all evidence required by the frozen policy was present.                                                     |
| `maintainerVerdict`       | `keep`, `iterate`, `remove`, or `undecided` after the observation window.                                                                                                                |

A disagreement about what the policy _should_ require is product feedback, not
automatically a false positive or false negative. First compare the report with
the policy that was actually frozen for the pilot.

## Sample selection

Use `all-consecutive` when possible. If a preselected sample is necessary,
write down the pull-request identifiers before enabling ReviewReady. Record
abandoned, timed-out, or technically unevaluable pull requests as friction; do
not quietly remove them from the narrative.

## Notes and links

Notes should describe reproducible behavior, such as:

- “The check name in the starter policy differed from this repository's CI
  check name.”
- “A fork pull request lacked the expected completed check during the first
  run.”

Avoid subjective estimates such as “hours saved” unless a separate,
predeclared timing study actually measured them. Evidence links may point to a
public run, a private participant-owned record, or a sanitized screenshot.
Never put access tokens or signed artifact URLs into the JSON record.

## Interpretation

Report the numerator and denominator together. For example, “0 confirmed false
negatives across 7 evaluated pull requests” is bounded and reproducible;
“perfect accuracy” is not. A maintainer verdict is qualitative feedback, not a
statistical result or testimonial unless publication of the wording was
separately approved.
