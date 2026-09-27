// Stand-in for `astro:env/server`, reading the process environment so a test sets a secret with `vi.stubEnv`.
export const getSecret = (name: string): string | undefined => process.env[name];
