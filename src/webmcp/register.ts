import type { WebMCPTool } from "@/webmcp/contracts";

export interface ModelContext {
  registerTool(
    tool: WebMCPTool,
    options: { readonly signal: AbortSignal },
  ): Promise<void>;
}

export function getModelContext(source: Document): ModelContext | null {
  const candidate = source as Document & { readonly modelContext?: ModelContext };
  return candidate.modelContext ?? null;
}

export function registerWebMCPTools(
  context: ModelContext,
  tools: readonly WebMCPTool[],
): {
  readonly ready: Promise<void>;
  unregister(): void;
} {
  const controller = new AbortController();
  const ready = Promise.all(tools.map(async (tool) => context.registerTool(tool, { signal: controller.signal })))
    .then(() => undefined)
    .catch((error: unknown) => {
      controller.abort();
      throw error;
    });
  return { ready, unregister: () => controller.abort() };
}
