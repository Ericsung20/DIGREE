export const normalizeEmail = (value: string): string => value.trim().toLowerCase();

/** Auth deliberately returns an obfuscated user for some duplicate signups. */
export function isExistingSignup(user: {identities?: unknown[]} | null): boolean {
  return user !== null && Array.isArray(user.identities) && user.identities.length === 0;
}
