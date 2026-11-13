/** Shortest password accepted by the app. */
export const MIN_PASSWORD = 8;

/** The new password is valid: long enough and different from the current one. */
export function newPasswordOk(current: string, next: string): boolean {
  return current.length > 0 && next.length >= MIN_PASSWORD && next !== current;
}
