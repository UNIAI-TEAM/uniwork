// The checks the sign-in screens make before a field reaches the server (spec §5.2), with the web's sentences: an
// empty or malformed address, an empty or short password, a display name the server would refuse, and the digits of
// a mailed or authenticator code. The server decides everything again; these only spare a round trip and say which
// field to fix. Each answer is an i18n key and its values, or null when the field is fine.

/** The server's floor for a new password (auth.Register, PUT /me/password). */
export const PASSWORD_MIN = 8;
/** The server's ceiling for a display name, in characters (service.maxDisplayNameRunes). */
export const DISPLAY_NAME_MAX = 100;
/** Every code the sign-in screens take is six digits (authenticator, mailed claim and verification codes). */
export const CODE_LENGTH = 6;

export interface FieldError {
  key: string;
  values?: Record<string, number>;
}

// One @, something on both sides, a dot in the domain, no spaces: what a person mistypes, not RFC 5322.
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function emailError(email: string): FieldError | null {
  const value = email.trim();
  if (!value) return { key: "auth.emailRequired" };
  return EMAIL.test(value) ? null : { key: "auth.emailInvalid" };
}

/** A password to sign in with is only required; a new one (`create`) is also long enough. */
export function passwordError(password: string, create = false): FieldError | null {
  if (!password) return { key: "auth.passwordRequired" };
  return create && password.length < PASSWORD_MIN ? { key: "settings.security.signInMethods.password.tooShort" } : null;
}

export function displayNameError(name: string): FieldError | null {
  const value = name.trim();
  if (!value) return { key: "auth.continue.create.displayNameRequired" };
  return [...value].length > DISPLAY_NAME_MAX ? { key: "auth.continue.create.displayNameTooLong", values: { max: DISPLAY_NAME_MAX } } : null;
}

/** What a code field keeps of what was typed or pasted: its digits, at most `CODE_LENGTH` of them. */
export function codeDigits(raw: string): string {
  return raw.replace(/\D/g, "").slice(0, CODE_LENGTH);
}
