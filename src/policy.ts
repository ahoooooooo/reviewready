import { parse } from "yaml";
import { z } from "zod";

import { checkConclusions, policyLimits, type Policy } from "./domain.js";
import { escapeControlCharacters, PolicyError } from "./errors.js";

const policyTextRuntimePattern =
  /^(?!\s)(?!.*\s$)(?!.*[\p{Control}\p{Format}\u2028\u2029])(?=.*[\p{Letter}\p{Number}\p{Punctuation}\p{Symbol}]).+$/u;
export const POLICY_TEXT_SCHEMA_PATTERN =
  "^(?!\\s)(?!.*\\s$)(?!.*[\\p{Control}\\p{Format}\\u2028\\u2029])(?=.*[\\p{Letter}\\p{Number}\\p{Punctuation}\\p{Symbol}]).+$";
const policyTextErrorPrefix = "Policy text is unsafe: ";
const text = z
  .string()
  .min(1)
  .superRefine((value, context) => {
    if (Array.from(value).length > policyLimits.maxTextLength) {
      context.addIssue({
        code: "custom",
        message:
          policyTextErrorPrefix +
          "Text exceeds the " +
          String(policyLimits.maxTextLength) +
          " Unicode code-point limit."
      });
    }
    if (!policyTextRuntimePattern.test(value)) {
      context.addIssue({
        code: "custom",
        message: policyTextErrorPrefix + escapeControlCharacters(value)
      });
    }
  });
const matchValues = z.array(text).min(1).max(policyLimits.maxMatchValues);

const matchSetSchema = z
  .object({
    any: matchValues.optional(),
    all: matchValues.optional(),
    none: matchValues.optional()
  })
  .strict()
  .refine(
    (value) => value.any !== undefined || value.all !== undefined || value.none !== undefined,
    {
      message: "At least one of any, all, or none is required."
    }
  );

const conditionSchema = z
  .object({
    paths: matchSetSchema.optional(),
    labels: matchSetSchema.optional()
  })
  .strict()
  .refine((value) => value.paths !== undefined || value.labels !== undefined, {
    message: "At least one path or label condition is required."
  });

const requirementSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("pr_body_section"),
      heading: text
    })
    .strict(),
  z.object({ type: z.literal("linked_issue") }).strict(),
  z
    .object({
      type: z.literal("check"),
      name: text,
      conclusions: z
        .array(z.enum(checkConclusions))
        .min(1)
        .max(policyLimits.maxCheckConclusions)
        .default(["success"]),
      app: text.optional()
    })
    .strict(),
  z
    .object({
      type: z.literal("maintainer_review"),
      minimum: z.number().int().min(1).max(20)
    })
    .strict(),
  z
    .object({
      type: z.literal("human_attestation"),
      text
    })
    .strict()
]);

const policySchema = z
  .object({
    version: z.literal(1),
    rules: z
      .array(
        z
          .object({
            id: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/),
            description: text.optional(),
            when: conditionSchema,
            require: z.array(requirementSchema).min(1).max(policyLimits.maxRequirementsPerRule)
          })
          .strict()
      )
      .min(1)
      .max(policyLimits.maxRules)
  })
  .strict();

function formatSchemaIssues(error: z.ZodError): string {
  return error.issues
    .slice(0, 10)
    .map(
      (issue) => `${issue.path.length === 0 ? "<root>" : issue.path.join(".")}: ${issue.message}`
    )
    .join("; ");
}

function isUnsafePattern(pattern: string): boolean {
  if (
    pattern.startsWith("!") ||
    pattern.startsWith("/") ||
    /^[A-Za-z]:\//u.test(pattern) ||
    pattern.includes("\\") ||
    pattern.includes("\0")
  ) {
    return true;
  }

  const segments = pattern.split("/");
  return segments.some((segment) => segment === "." || segment === ".." || segment.length === 0);
}

function validateSemantics(policy: Policy): void {
  const ids = new Set<string>();
  for (const rule of policy.rules) {
    if (ids.has(rule.id)) {
      throw new PolicyError("POLICY_DUPLICATE_RULE_ID", `Rule id "${rule.id}" is duplicated.`);
    }
    ids.add(rule.id);

    const patterns = [
      ...(rule.when.paths?.any ?? []),
      ...(rule.when.paths?.all ?? []),
      ...(rule.when.paths?.none ?? [])
    ];
    for (const pattern of patterns) {
      if (isUnsafePattern(pattern)) {
        throw new PolicyError(
          "POLICY_UNSAFE_PATTERN",
          `Rule "${rule.id}" uses unsafe or ambiguous path pattern "${pattern}". Use repository-relative POSIX patterns without negation.`
        );
      }
    }
  }
}

export function parsePolicy(source: string): Policy {
  if (Buffer.byteLength(source, "utf8") > policyLimits.maxPolicyBytes) {
    throw new PolicyError("POLICY_TOO_LARGE", "Policy exceeds the 256 KiB v1 size limit.");
  }

  let document: unknown;
  try {
    document = parse(source, { maxAliasCount: 100, prettyErrors: false, strict: true });
  } catch (error) {
    throw new PolicyError("POLICY_YAML_INVALID", "Policy is not valid YAML.", { cause: error });
  }

  const parsed = policySchema.safeParse(document);
  if (!parsed.success) {
    const textError = parsed.error.issues.some((issue) =>
      issue.message.startsWith(policyTextErrorPrefix)
    );
    throw new PolicyError(
      textError ? "POLICY_TEXT_INVALID" : "POLICY_SCHEMA_INVALID",
      `Policy does not match version 1 schema: ${formatSchemaIssues(parsed.error)}`
    );
  }

  const policy: Policy = parsed.data;
  validateSemantics(policy);
  return policy;
}
