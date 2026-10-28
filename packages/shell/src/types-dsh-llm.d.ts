/**
 * Minimal ambient declaration for @deepseek-ai/dsh-llm — the package is not
 * on the public npm registry (it only resolves inside the global dsh closure),
 * so the shell package declares just the surface it uses at runtime.
 */
declare module "@deepseek-ai/dsh-llm" {
  export function createUserMessage(init: any): any
}
