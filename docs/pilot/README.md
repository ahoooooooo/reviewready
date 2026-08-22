# ReviewReady consented pilot kit

This kit helps a maintainer evaluate ReviewReady in one repository without
turning a trial into an adoption claim. It is designed for a short, reversible,
advisory pilot. It does not contact ReviewReady infrastructure, upload evidence,
or create telemetry.

A repository is an **external pilot** only when someone authorized to represent
that repository explicitly agrees to the trial. Testing this project against
itself is **self-dogfood**. A fixture, generated example, download count, star,
or unsolicited run is neither.

## Safe default

- Start with an advisory check. Do not make it a required merge check during
  evaluation.
- Use an immutable ReviewReady commit or verified release pin.
- Grant only the read permissions documented in the main README.
- Never use a `pull_request_target` job that checks out or executes pull-request
  code.
- Do not paste tokens, private source, pull-request bodies, email addresses, or
  unpublished vulnerability details into the pilot record.
- Keep consent separately if the participant does not approve publishing it.
- Agree on the removal path before installation.

## Pilot sequence

### 1. Define the question

Choose one repository and one narrow question, for example:

> Can ReviewReady identify missing testing and issue-link evidence before a
> maintainer begins review?

Freeze the policy and ReviewReady reference for the observation window. Do not
change the rules after seeing outcomes unless the record is restarted or the
change is listed as a pilot limitation.

### 2. Obtain consent

Complete [the consent template](consent-template.md) with an authorized
maintainer. Choose one evidence publication scope:

- `private`: the record is retained only by the participants;
- `anonymous-public`: sanitized aggregate results may be published without
  naming the repository; or
- `named-public`: the repository and approved links may be published.

Consent to run the pilot is not consent to publish a testimonial. Keep the
maintainer's words verbatim only when that exact text is approved.

### 3. Establish a baseline

Before enabling the check, choose the sample:

- preferably all consecutive eligible pull requests during a fixed window; or
- a preselected, documented set of pull requests.

Record the selection method. Do not omit failures after the pilot starts. For a
small repository, 5–10 eligible pull requests or two weeks is a practical first
observation window, but a smaller completed sample is still reportable as long
as its size is explicit.

### 4. Install reversibly

Use the current stable release for a release pilot, or identify an exact source
commit for a source-preview pilot. The next-minor `init` command is not part of
the currently published v1.0.11 package.

For the source preview:

```console
npm ci
npm run build
node dist/cli.js init
node dist/cli.js validate --policy .reviewready.yml
```

Review the generated policy before committing it. Follow the main README for an
advisory GitHub Actions workflow. ReviewReady does not alter branch protection,
rulesets, repository settings, or workflows automatically.

### 5. Observe and classify

For each eligible pull request, wait for a completed ReviewReady result and
classify it using [the measurement guide](measurement-guide.md). Record only
counts and sanitized notes. Links are optional unless an observed external
pilot is being used as evidence; private evidence links may remain accessible
only to the participants.

### 6. Validate the record

Copy the [example record](../../fixtures/pilot/pilot-evidence-example-v1.json),
replace every placeholder, set `recordStatus` to `observed`, and validate it:

```console
node scripts/validate-pilot-evidence.mjs path/to/pilot-evidence.json
```

The schema is [evidence.schema.json](evidence.schema.json). Validation checks
the closed shape, bounded fields, consent/claim conditions, observation dates,
and outcome totals. It does not prove that the supplied observations are true;
retain the approved underlying links or private notes for that purpose.

### 7. Confirm publication and remove

Show the final sanitized record to the consenting maintainer before publishing
anything. Respect the recorded scope. To remove the trial:

1. remove the advisory workflow and pilot policy if they were added only for the
   trial;
2. remove any required-check setting that participants separately enabled;
3. uninstall a global CLI with `npm uninstall --global @ahoooooo/reviewready`;
4. delete or further redact retained evidence as agreed; and
5. record that removal was completed.

## What a completed record proves

An observed self-dogfood record proves only that this repository exercised its
own workflow. One consented external record proves one external pilot under the
recorded policy, version, sample, and limitations. Neither proves broad
adoption, universal correctness, production authority, or time saved outside
the measured facts.

Issue [#61](https://github.com/ahoooooooo/reviewready/issues/61) tracks the
external dependency: finding a consenting maintainer and running the pilot.
That step cannot be replaced by generated data.
