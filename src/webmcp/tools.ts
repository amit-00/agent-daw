import type {
  EntityReference,
  ToolContract,
  ToolErrorCode,
  ToolResult,
  WebMCPTool,
  WebMCPToolName,
} from "./contracts.ts";

class InputError extends Error {
  constructor(readonly field: string, message: string) {
    super(message);
    this.name = "InputError";
  }
}

const invalid = (field: string, expectation: string): never => {
  throw new InputError(field, `${field} ${expectation}.`);
};

export const expectObject = (value: unknown, field: string): Readonly<Record<string, unknown>> => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return invalid(field, "must be an object");
  }
  return value as Readonly<Record<string, unknown>>;
};

export const expectAllowedKeys = (
  value: Readonly<Record<string, unknown>>,
  allowed: readonly string[],
  field: string,
): void => {
  const unexpected = Object.keys(value).find((key) => !allowed.includes(key));
  if (unexpected !== undefined) invalid(field === "$" ? unexpected : `${field}.${unexpected}`, "is not allowed");
};

export const expectString = (
  value: unknown,
  field: string,
  minimumLength = 1,
  maximumLength?: number,
): string => {
  if (typeof value !== "string") return invalid(field, "must be a string");
  const length = value.trim().length;
  if (length < minimumLength || (maximumLength !== undefined && length > maximumLength)) {
    return invalid(field, maximumLength === undefined
      ? `must contain at least ${minimumLength} non-whitespace character${minimumLength === 1 ? "" : "s"}`
      : `must contain ${minimumLength} to ${maximumLength} non-whitespace characters`);
  }
  return value;
};

export const expectBoolean = (value: unknown, field: string): boolean => {
  if (typeof value !== "boolean") return invalid(field, "must be a boolean");
  return value;
};

export const expectFiniteNumber = (
  value: unknown,
  field: string,
  minimum?: number,
  maximum?: number,
): number => {
  if (typeof value !== "number" || !Number.isFinite(value)) return invalid(field, "must be a finite number");
  if ((minimum !== undefined && value < minimum) || (maximum !== undefined && value > maximum)) {
    return invalid(field, `must be from ${minimum ?? "negative infinity"} to ${maximum ?? "infinity"}`);
  }
  return value;
};

export const expectInteger = (
  value: unknown,
  field: string,
  minimum?: number,
  maximum?: number,
): number => {
  const number = expectFiniteNumber(value, field, minimum, maximum);
  if (!Number.isInteger(number)) return invalid(field, "must be an integer");
  return number;
};

export const expectArray = (value: unknown, field: string): readonly unknown[] => {
  if (!Array.isArray(value)) return invalid(field, "must be an array");
  return value;
};

export const expectEnum = <T extends string | number>(
  value: unknown,
  field: string,
  values: readonly T[],
): T => {
  const matched = values.find((candidate) => candidate === value);
  if (matched === undefined) return invalid(field, `must be one of ${values.join(", ")}`);
  return matched;
};

export const expectEntityReference = (value: unknown, field: string): EntityReference => {
  const reference = expectObject(value, field);
  expectAllowedKeys(reference, ["id", "ref"], field);
  const hasId = Object.hasOwn(reference, "id");
  const hasRef = Object.hasOwn(reference, "ref");
  if (hasId === hasRef) return invalid(field, "must contain exactly one of id or ref");
  if (hasId) return { id: expectString(reference.id, `${field}.id`) };
  const ref = expectString(reference.ref, `${field}.ref`, 1, 64);
  if (!/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(ref)) {
    return invalid(`${field}.ref`, "must start with a letter and contain only letters, digits, underscores, or hyphens");
  }
  return { ref };
};

type ToolFailure = Extract<ToolResult<never>, { readonly success: false }>;

const failure = (
  code: ToolErrorCode,
  message: string,
  retryable: boolean,
  field?: string,
): ToolFailure => ({
  success: false,
  error: { code, message, retryable, ...(field === undefined ? {} : { field }) },
});

const mapKnownError = (toolName: WebMCPToolName, error: unknown): ToolFailure => {
  if (error instanceof InputError) return failure("INVALID_INPUT", error.message, false, error.field);
  if (error instanceof DOMException && error.name === "AbortError") {
    return failure("EXECUTION_CANCELLED", "The tool call was cancelled.", true);
  }
  console.error("WebMCP tool failed", toolName, error instanceof Error ? error : new Error("Non-Error thrown"));
  return failure("INTERNAL_ERROR", "The tool could not complete because of an internal error.", false);
};

async function executeSafely<T>(
  toolName: WebMCPToolName,
  signal: AbortSignal,
  run: () => T | Promise<T>,
): Promise<ToolResult<T>> {
  const startedAt = performance.now();
  try {
    if (signal.aborted) {
      return failure("EXECUTION_CANCELLED", "The tool call was cancelled.", true);
    }
    const result = await run();
    console.debug("WebMCP tool", {
      toolName,
      outcome: "success",
      elapsedMs: Math.round(performance.now() - startedAt),
    });
    return { success: true, result };
  } catch (error) {
    const result = mapKnownError(toolName, error);
    console.debug("WebMCP tool", {
      toolName,
      outcome: result.error.code,
      elapsedMs: Math.round(performance.now() - startedAt),
    });
    return result;
  }
}

export function defineWebMCPTool<T>(
  contract: ToolContract,
  parse: (input: Readonly<Record<string, unknown>>) => T,
  run: (input: T, signal: AbortSignal) => unknown | Promise<unknown>,
): WebMCPTool {
  const schemaProperties = expectObject(contract.inputSchema.properties, "inputSchema.properties");
  const allowedKeys = Object.keys(schemaProperties);
  return {
    ...contract,
    execute: (input, { signal }) => executeSafely(contract.name, signal, () => {
      const object = expectObject(input, "$");
      expectAllowedKeys(object, allowedKeys, "$");
      return run(parse(object), signal);
    }),
  };
}
