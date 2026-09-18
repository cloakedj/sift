export function revokeSession(tokens: Map<string, string>, user: string) {
  tokens.delete(user);
}
