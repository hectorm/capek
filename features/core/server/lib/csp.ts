import type { H3Event } from "h3";

// Sources of the directives of the Content Security Policy, like `{ "frame-src": ["https://example.com"] }`
export type CspSources = Readonly<Record<string, readonly string[]>>;

// Sources that a feature adds to the policy, resolved on each request when they depend on its configuration
export type CspContribution = CspSources | ((event: H3Event) => CspSources | Promise<CspSources>);

const DIRECTIVE_PATTERN = /^[a-z][a-z-]*$/;
// A source cannot contain the characters that would start another source, directive or policy
const SOURCE_PATTERN = /^[^\s;,]+$/;

export const assertCspSources = (sources: CspSources): void => {
  for (const [name, values] of Object.entries(sources)) {
    if (!DIRECTIVE_PATTERN.test(name)) {
      throw new Error(`Invalid Content Security Policy directive "${name}"`);
    }
    const invalid = values.find((value) => !SOURCE_PATTERN.test(value));
    if (invalid !== undefined) {
      throw new Error(`Invalid Content Security Policy source "${invalid}"`);
    }
  }
};

export const composeCsp = (base: CspSources, contributions: readonly CspSources[]): string => {
  const directives = new Map(Object.entries(base).map(([name, values]) => [name, new Set(values)]));

  for (const sources of contributions) {
    assertCspSources(sources);
    for (const [name, values] of Object.entries(sources)) {
      // A directive that is not in the policy starts from the sources of "default-src", which it stops falling back to
      const directive = directives.get(name) ?? new Set(directives.get("default-src"));
      values.forEach((value) => directive.add(value));
      directives.set(name, directive);
    }
  }

  return [...directives].map(([name, values]) => [name, ...values].join(" ")).join("; ");
};
