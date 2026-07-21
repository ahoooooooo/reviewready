import * as core from "@actions/core";
import { context } from "@actions/github";

import { runAction } from "./action-runner.js";
import { createGitHubGateway } from "./github-api.js";

await runAction({
  eventName: context.eventName,
  event: context.payload,
  getInput: (name) => core.getInput(name),
  createGateway: createGitHubGateway,
  setOutput: (name, value) => {
    core.setOutput(name, value);
  },
  setFailed: (message) => {
    core.setFailed(message);
  },
  writeSummary: async (markdown) => {
    await core.summary.addRaw(markdown).write();
  }
});
