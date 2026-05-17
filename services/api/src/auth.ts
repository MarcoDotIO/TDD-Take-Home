import type { AuthContext, UserRole } from "@cola/shared";

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message);
  }
}

export function authFromRequest(request: Request): AuthContext {
  const userId = request.headers.get("x-user-id")?.trim();
  const email = request.headers.get("x-user-email")?.trim() || "local-user@example.gov";
  const roles = parseRoles(request.headers.get("x-user-roles"));

  if (!userId) {
    throw new HttpError(401, "Missing x-user-id header for local auth.");
  }

  return { userId, email, roles };
}

export function requireRole(auth: AuthContext, role: UserRole): void {
  if (!auth.roles.includes(role)) {
    throw new HttpError(403, `Requires ${role} role.`);
  }
}

export function canReadSubmission(auth: AuthContext, applicantId: string): boolean {
  return auth.roles.includes("admin") || auth.userId === applicantId;
}

function parseRoles(raw: string | null): UserRole[] {
  const roles = (raw ?? "applicant")
    .split(",")
    .map((role) => role.trim().toLowerCase())
    .filter((role): role is UserRole => role === "admin" || role === "applicant");
  return roles.length ? roles : ["applicant"];
}
