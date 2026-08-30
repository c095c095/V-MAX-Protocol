// ADR 0008: optional shared-secret authentication on REGISTER.

/** `secret === undefined` means the server was started without `--secret` — auth is off. */
export function isAuthorized(headers: Record<string, string>, secret: string | undefined): boolean {
  if (secret === undefined) return true;
  return headers['Auth-Token'] === secret;
}
