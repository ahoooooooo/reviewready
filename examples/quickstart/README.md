# Quickstart example

This example proves both ReviewReady outcomes without GitHub access, credentials,
model calls, or execution of pull-request code.

From a source checkout:

```console
npm ci
npm run build
node dist/cli.js demo
node dist/cli.js validate --policy examples/quickstart/.reviewready.yml
node dist/cli.js check --policy examples/quickstart/.reviewready.yml --input examples/quickstart/ready.json
node dist/cli.js check --policy examples/quickstart/.reviewready.yml --input examples/quickstart/not-ready.json
```

The ready fixture exits `0`. The not-ready fixture intentionally exits `1` and
lists the missing `Testing` section and linked issue. Exit `1` is the expected
product result for that final command, not a runtime failure.

The next-minor `reviewready init` command creates the same starter policy as
`.reviewready.yml` in the current directory and refuses to overwrite an existing
file. It does not create a workflow or change repository settings; use the
README's advisory or trusted Action guidance after tailoring the policy.
