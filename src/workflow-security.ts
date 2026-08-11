export const MAX_WORKFLOW_SOURCE_BYTES = 256 * 1024;
export const MAX_WORKFLOW_PATH_LENGTH = 512;
export const MAX_WORKFLOW_FINDINGS = 100;

export type WorkflowFindingCategory =
  "prompt_injection" | "code_execution" | "capability" | "provenance";

export interface WorkflowSecurityFinding {
  readonly ruleId: string;
  readonly category: WorkflowFindingCategory;
  readonly severity: "error" | "warning";
  readonly path: string;
  readonly line: number;
  readonly message: string;
}

export interface WorkflowSecurityAnalysis {
  readonly path: string;
  readonly findings: readonly WorkflowSecurityFinding[];
}

const PINNED_ACTION = /uses\s*:\s*[^\s#]+@([0-9a-f]{40})(?:\s|#|$)/iu;
const ACTION_REFERENCE = /uses\s*:\s*([^\s#]+)/iu;
const UNTRUSTED_BODY = /github\.event\.(?:pull_request|issue|comment|review)\.(?:body|title)/iu;
const MODEL_OUTPUT = /\$\{\{\s*(?:steps\.[\w-]+\.outputs\.|needs\.[\w-]+\.outputs\.)/iu;
const DEPLOYMENT = /\b(?:deploy|kubectl|terraform\s+apply|npm\s+publish|git\s+push)\b/iu;
const SECRET_OR_TOKEN =
  /(?:\bsecrets(?:\.[\w-]+|\s*\[[^\]\r\n]{1,128}\])|\bgithub(?:\.(?:token|pat)|\s*\[\s*["'](?:token|pat)["']\s*\]))/iu;
const SECRETS_INHERIT = /\bsecrets\s*:\s*inherit\b/iu;
const AI_CONTEXT = /\b(?:ai|llm|model|prompt|openai|anthropic|chatgpt)\b/iu;
const SHELL_EVALUATOR =
  /\b(?:bash|sh|zsh|pwsh|powershell|cmd)\b[^\r\n]*\s-c\b|\beval\b|\bsource\b/iu;
const DIRECT_UNTRUSTED_COMMAND =
  /^\s*["']?\$\{\{\s*github\.event\.(?:pull_request|issue|comment|review)\.(?:body|title)/iu;
const YAML_NAME = /^\s*(?:-\s*)?([A-Za-z_][A-Za-z0-9_]*)\s*:/u;
const SHELL_RUN = /^\s*(?:-\s*|\w[\w-]*\s*)?run\s*:/iu;
const PROMPT_BOUNDARY = /\b(?:prompt|message|instruction|input)\b/iu;

interface ShellLine {
  readonly text: string;
  readonly line: number;
}

function assignedNames(
  lines: readonly string[],
  predicate: (line: string) => boolean
): ReadonlySet<string> {
  const names = new Set<string>();
  for (const line of lines) {
    if (!predicate(line)) {
      continue;
    }
    const name = YAML_NAME.exec(line)?.[1];
    if (name !== undefined) {
      names.add(name);
    }
  }
  return names;
}

function referencesShellVariable(line: string, name: string): boolean {
  return new RegExp(`(?:\\$\\{?${name}\\}?|%${name}%|\\b${name}\\b)`, "u").test(line);
}

function stripYamlComment(line: string): string {
  return line.replace(/(?:^|\s+)#.*$/u, "");
}

function collectShellLines(lines: readonly string[]): readonly ShellLine[] {
  const shellLines: ShellLine[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const declaration = lines[index];
    if (declaration === undefined || !SHELL_RUN.test(declaration)) {
      continue;
    }
    shellLines.push({ text: declaration, line: index + 1 });
    if (!/\brun\s*:\s*[|>]/iu.test(declaration)) {
      continue;
    }
    const declarationIndent = declaration.length - declaration.trimStart().length;
    for (let bodyIndex = index + 1; bodyIndex < lines.length; bodyIndex += 1) {
      const body = lines[bodyIndex];
      if (body === undefined) {
        break;
      }
      if (body.trim().length > 0) {
        const bodyIndent = body.length - body.trimStart().length;
        if (bodyIndent <= declarationIndent) {
          break;
        }
      }
      shellLines.push({ text: body, line: bodyIndex + 1 });
    }
  }
  return shellLines;
}

function isDirectUntrustedCommand(text: string): boolean {
  return DIRECT_UNTRUSTED_COMMAND.test(text.replace(SHELL_RUN, ""));
}

function isTaintedCommand(text: string, names: ReadonlySet<string>): boolean {
  const command = text.replace(SHELL_RUN, "").trim();
  return [...names].some((name) =>
    new RegExp(`^["']?\\$\\{?${name}\\}?["']?(?:\\s|$)`, "u").test(command)
  );
}

function hasControlCharacter(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    if ((codePoint >= 0 && codePoint <= 31) || (codePoint >= 127 && codePoint <= 159)) {
      return true;
    }
  }
  return false;
}

const RULE_ORDER = new Map([
  ["WORKFLOW_SOURCE_TOO_LARGE", 0],
  ["WORKFLOW_PATH_INVALID", 1],
  ["WORKFLOW_FINDINGS_TRUNCATED", 2],
  ["ACTION_REF_NOT_PINNED", 10],
  ["PULL_REQUEST_TARGET_UNTRUSTED_CODE", 20],
  ["PULL_REQUEST_TARGET_WORKFLOW", 21],
  ["WORKFLOW_WRITE_PERMISSION", 30],
  ["SECRETS_INHERIT", 35],
  ["UNTRUSTED_TEXT_IN_PROMPT", 40],
  ["SECRET_IN_PROMPT", 50],
  ["UNTRUSTED_TEXT_TO_SHELL", 55],
  ["MODEL_OUTPUT_TO_SHELL", 60],
  ["DEPLOYMENT_SINK", 70]
]);

function lineNumber(lines: readonly string[], predicate: (line: string) => boolean): number {
  const index = lines.findIndex(predicate);
  return index < 0 ? 1 : index + 1;
}

function finding(
  path: string,
  ruleId: string,
  category: WorkflowFindingCategory,
  line: number,
  message: string,
  severity: "error" | "warning" = "error"
): WorkflowSecurityFinding {
  return { path, ruleId, category, severity, line, message };
}

export function analyzeWorkflowSource(path: string, source: string): WorkflowSecurityAnalysis {
  if (path.length === 0 || path.length > MAX_WORKFLOW_PATH_LENGTH || hasControlCharacter(path)) {
    return {
      path,
      findings: [
        finding(
          path,
          "WORKFLOW_PATH_INVALID",
          "provenance",
          1,
          "Workflow path is invalid or over the bounded limit."
        )
      ]
    };
  }
  if (Buffer.byteLength(source, "utf8") > MAX_WORKFLOW_SOURCE_BYTES) {
    return {
      path,
      findings: [
        finding(
          path,
          "WORKFLOW_SOURCE_TOO_LARGE",
          "provenance",
          1,
          "Workflow source exceeds the bounded audit limit."
        )
      ]
    };
  }

  const lines = source.split(/\r?\n/u);
  const shellLines = collectShellLines(lines);
  const findings: WorkflowSecurityFinding[] = [];
  const state = { truncated: false };
  const add = (result: WorkflowSecurityFinding): void => {
    if (findings.length < MAX_WORKFLOW_FINDINGS - 1) {
      findings.push(result);
    } else {
      state.truncated = true;
    }
  };

  for (const [index, line] of lines.entries()) {
    const codeLine = stripYamlComment(line);
    if (ACTION_REFERENCE.test(codeLine) && !PINNED_ACTION.test(codeLine)) {
      add(
        finding(
          path,
          "ACTION_REF_NOT_PINNED",
          "provenance",
          index + 1,
          "Action reference is not pinned to a full commit SHA."
        )
      );
    }
  }

  if (/pull_request_target/iu.test(source)) {
    const hasPrHeadCheckout =
      /checkout[\s\S]{0,200}github\.event\.pull_request\.head(?:\.sha)?/iu.test(source);
    add(
      finding(
        path,
        hasPrHeadCheckout ? "PULL_REQUEST_TARGET_UNTRUSTED_CODE" : "PULL_REQUEST_TARGET_WORKFLOW",
        "capability",
        lineNumber(lines, (line) => /pull_request_target/iu.test(line)),
        hasPrHeadCheckout
          ? "pull_request_target checks out or reaches the pull-request head content."
          : "pull_request_target is a privileged workflow root and requires an independently protected path."
      )
    );
  }

  const writeLine = lines.find((line) =>
    /permissions\s*:\s*write-all|(?:actions|checks|contents|deployments|id-token|packages|security-events|statuses)\s*:\s*write/iu.test(
      line
    )
  );
  if (writeLine !== undefined) {
    add(
      finding(
        path,
        "WORKFLOW_WRITE_PERMISSION",
        "capability",
        lineNumber(lines, (line) => line === writeLine),
        "Workflow grants a write-capable permission to an audit-sensitive path."
      )
    );
  }

  const inheritedSecretsLine = lines.find((line) => SECRETS_INHERIT.test(stripYamlComment(line)));
  if (inheritedSecretsLine !== undefined) {
    add(
      finding(
        path,
        "SECRETS_INHERIT",
        "capability",
        lineNumber(lines, (line) => line === inheritedSecretsLine),
        "A reusable workflow inherits the caller's complete secret set."
      )
    );
  }

  const untrustedBodyVariables = assignedNames(lines, (line) => UNTRUSTED_BODY.test(line));
  const promptLine = lines.find((line) => {
    if (UNTRUSTED_BODY.test(line) && AI_CONTEXT.test(line)) {
      return true;
    }
    return (
      AI_CONTEXT.test(line) &&
      PROMPT_BOUNDARY.test(line) &&
      [...untrustedBodyVariables].some((name) => referencesShellVariable(line, name))
    );
  });
  if (promptLine !== undefined) {
    add(
      finding(
        path,
        "UNTRUSTED_TEXT_IN_PROMPT",
        "prompt_injection",
        lineNumber(lines, (line) => line === promptLine),
        "Untrusted pull-request text reaches an AI prompt or model input."
      )
    );
  }

  const untrustedShellLine = shellLines.find(
    ({ text }) =>
      (SHELL_EVALUATOR.test(text) ||
        isDirectUntrustedCommand(text) ||
        isTaintedCommand(text, untrustedBodyVariables)) &&
      (UNTRUSTED_BODY.test(text) ||
        [...untrustedBodyVariables].some((name) => referencesShellVariable(text, name)))
  );
  if (untrustedShellLine !== undefined) {
    add(
      finding(
        path,
        "UNTRUSTED_TEXT_TO_SHELL",
        "code_execution",
        untrustedShellLine.line,
        "Untrusted pull-request text reaches a shell evaluation command."
      )
    );
  }

  const secretLine = lines.find((line) => SECRET_OR_TOKEN.test(line));
  if (secretLine !== undefined && AI_CONTEXT.test(source)) {
    add(
      finding(
        path,
        "SECRET_IN_PROMPT",
        "capability",
        lineNumber(lines, (line) => line === secretLine),
        "A secret or token is available in an AI workflow context."
      )
    );
  }

  const modelOutputVariables = assignedNames(lines, (line) => MODEL_OUTPUT.test(line));
  const modelOutputLine = shellLines.find(
    ({ text }) =>
      MODEL_OUTPUT.test(text) ||
      [...modelOutputVariables].some((name) => referencesShellVariable(text, name))
  );
  if (modelOutputLine !== undefined) {
    add(
      finding(
        path,
        "MODEL_OUTPUT_TO_SHELL",
        "code_execution",
        modelOutputLine.line,
        "Model-controlled output reaches a shell command."
      )
    );
  }

  const deploymentLine = shellLines.find(({ text }) => DEPLOYMENT.test(text));
  if (deploymentLine !== undefined) {
    add(
      finding(
        path,
        "DEPLOYMENT_SINK",
        "capability",
        deploymentLine.line,
        "A workflow exposes a deployment or publication capability to a command path."
      )
    );
  }

  if (state.truncated) {
    findings.push(
      finding(
        path,
        "WORKFLOW_FINDINGS_TRUNCATED",
        "provenance",
        1,
        "The workflow finding limit was reached; the analysis is incomplete."
      )
    );
  }
  findings.sort((left, right) => {
    const order =
      (RULE_ORDER.get(left.ruleId) ?? Number.MAX_SAFE_INTEGER) -
      (RULE_ORDER.get(right.ruleId) ?? Number.MAX_SAFE_INTEGER);
    return order || left.line - right.line || left.ruleId.localeCompare(right.ruleId);
  });
  return { path, findings };
}
