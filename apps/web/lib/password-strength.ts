export type PasswordStrength = "weak" | "medium" | "strong";

// Visual-only indicator (.ai/knowledge/screens/auth-screens.md "Register" AC) — the actual
// requirement enforced is the Zod schema's min(8)/max(128), not this heuristic.
export function passwordStrength(password: string): PasswordStrength | null {
  if (!password) return null;

  let score = 0;
  if (password.length >= 8) score++;
  if (password.length >= 12) score++;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score++;
  if (/\d/.test(password)) score++;
  if (/[^A-Za-z0-9]/.test(password)) score++;

  if (score <= 1) return "weak";
  if (score <= 3) return "medium";
  return "strong";
}
