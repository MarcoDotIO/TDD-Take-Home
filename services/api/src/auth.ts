import { createHmac, randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import type { AuthContext, UserRole } from "@cola/shared";

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message);
  }
}

export interface UserAccount {
  id: string;
  email: string;
  passwordHash: string;
  roles: UserRole[];
  createdAt: string;
}

export interface UserRepository {
  findByEmail(email: string): Promise<UserAccount | undefined>;
  create(account: UserAccount): Promise<UserAccount>;
}

export interface AuthSession {
  token: string;
  expiresAt: string;
  user: AuthContext;
}

interface AuthServiceOptions {
  tokenSecret?: string;
  tokenTtlSeconds?: number;
  adminEmails?: string[];
  adminBootstrapPassword?: string;
}

interface TokenPayload {
  sub: string;
  email: string;
  roles: UserRole[];
  iat: number;
  exp: number;
}

const LOCAL_DEV_AUTH_SECRET = "local-dev-only-change-me";
const DEFAULT_TOKEN_TTL_SECONDS = 12 * 60 * 60;

export class InMemoryUserRepository implements UserRepository {
  private usersByEmail = new Map<string, UserAccount>();

  async findByEmail(email: string): Promise<UserAccount | undefined> {
    return this.usersByEmail.get(normalizeEmail(email));
  }

  async create(account: UserAccount): Promise<UserAccount> {
    const email = normalizeEmail(account.email);
    if (this.usersByEmail.has(email)) throw new HttpError(409, "Account already exists.");
    const normalized = { ...account, email };
    this.usersByEmail.set(email, normalized);
    return normalized;
  }
}

export class AuthService {
  private readonly tokenSecret: string;
  private readonly tokenTtlSeconds: number;
  private readonly adminEmails: Set<string>;
  private readonly adminBootstrapPassword: string;

  constructor(
    private users: UserRepository,
    options: AuthServiceOptions = {}
  ) {
    this.tokenSecret = options.tokenSecret ?? process.env.AUTH_SECRET ?? LOCAL_DEV_AUTH_SECRET;
    this.tokenTtlSeconds = options.tokenTtlSeconds ?? (Number(process.env.AUTH_TOKEN_TTL_SECONDS) || DEFAULT_TOKEN_TTL_SECONDS);
    this.adminEmails = new Set((options.adminEmails ?? parseCsv(process.env.ADMIN_EMAILS)).map(normalizeEmail));
    this.adminBootstrapPassword = options.adminBootstrapPassword ?? process.env.ADMIN_BOOTSTRAP_PASSWORD ?? "admin-password";

    if (process.env.USE_AWS_STORAGE === "true" && this.tokenSecret === LOCAL_DEV_AUTH_SECRET) {
      throw new Error("AUTH_SECRET must be configured when USE_AWS_STORAGE=true.");
    }
  }

  async registerApplicant(email: string, password: string): Promise<AuthSession> {
    const normalizedEmail = requireEmail(email);
    requirePassword(password);
    if (this.adminEmails.has(normalizedEmail)) {
      throw new HttpError(403, "This email is reserved for admin access.");
    }
    const existing = await this.users.findByEmail(normalizedEmail);
    if (existing) throw new HttpError(409, "Account already exists.");
    const account = await this.users.create({
      id: randomUUID(),
      email: normalizedEmail,
      passwordHash: hashPassword(password),
      roles: ["applicant"],
      createdAt: new Date().toISOString()
    });
    return this.createSession(account);
  }

  async login(email: string, password: string): Promise<AuthSession> {
    const normalizedEmail = requireEmail(email);
    requirePassword(password);
    let account = await this.users.findByEmail(normalizedEmail);

    if (!account && this.adminEmails.has(normalizedEmail)) {
      if (password !== this.adminBootstrapPassword) throw new HttpError(401, "Invalid email or password.");
      account = await this.users.create({
        id: randomUUID(),
        email: normalizedEmail,
        passwordHash: hashPassword(password),
        roles: ["admin"],
        createdAt: new Date().toISOString()
      });
    }

    if (!account || !verifyPassword(password, account.passwordHash)) {
      throw new HttpError(401, "Invalid email or password.");
    }
    return this.createSession(account);
  }

  authFromRequest(request: Request): AuthContext {
    const authorization = request.headers.get("authorization") ?? "";
    const match = authorization.match(/^Bearer\s+(.+)$/i);
    if (!match) throw new HttpError(401, "Missing bearer token.");
    return this.verifyToken(match[1]);
  }

  verifyToken(token: string): AuthContext {
    const parts = token.split(".");
    if (parts.length !== 3) throw new HttpError(401, "Invalid bearer token.");
    const [encodedHeader, encodedPayload, signature] = parts;
    const expected = sign(`${encodedHeader}.${encodedPayload}`, this.tokenSecret);
    if (!constantTimeEqual(signature, expected)) throw new HttpError(401, "Invalid bearer token.");

    let payload: TokenPayload;
    try {
      payload = JSON.parse(base64UrlDecode(encodedPayload).toString("utf8")) as TokenPayload;
    } catch {
      throw new HttpError(401, "Invalid bearer token.");
    }

    if (!payload.sub || !payload.email || !Array.isArray(payload.roles)) {
      throw new HttpError(401, "Invalid bearer token.");
    }
    if (payload.exp <= nowSeconds()) throw new HttpError(401, "Session expired.");
    const roles = payload.roles.filter((role): role is UserRole => role === "admin" || role === "applicant");
    if (!roles.length) throw new HttpError(401, "Invalid bearer token.");
    return { userId: payload.sub, email: payload.email, roles };
  }

  private createSession(account: UserAccount): AuthSession {
    const iat = nowSeconds();
    const exp = iat + this.tokenTtlSeconds;
    const payload: TokenPayload = {
      sub: account.id,
      email: account.email,
      roles: account.roles,
      iat,
      exp
    };
    const encodedHeader = base64UrlEncode(Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })));
    const encodedPayload = base64UrlEncode(Buffer.from(JSON.stringify(payload)));
    const body = `${encodedHeader}.${encodedPayload}`;
    return {
      token: `${body}.${sign(body, this.tokenSecret)}`,
      expiresAt: new Date(exp * 1000).toISOString(),
      user: { userId: account.id, email: account.email, roles: account.roles }
    };
  }
}

export function requireRole(auth: AuthContext, role: UserRole): void {
  if (!auth.roles.includes(role)) {
    throw new HttpError(403, `Requires ${role} role.`);
  }
}

export function canReadSubmission(auth: AuthContext, applicantId: string): boolean {
  return auth.roles.includes("admin") || auth.userId === applicantId;
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function requireEmail(email: string): string {
  const normalized = normalizeEmail(email);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) throw new HttpError(400, "Valid email is required.");
  return normalized;
}

function requirePassword(password: string): void {
  if (typeof password !== "string" || password.length < 8) {
    throw new HttpError(400, "Password must be at least 8 characters.");
  }
}

function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("base64url");
  const hash = scryptSync(password, salt, 32).toString("base64url");
  return `scrypt:${salt}:${hash}`;
}

function verifyPassword(password: string, passwordHash: string): boolean {
  const [scheme, salt, expected] = passwordHash.split(":");
  if (scheme !== "scrypt" || !salt || !expected) return false;
  const actual = scryptSync(password, salt, 32);
  return constantTimeEqual(actual.toString("base64url"), expected);
}

function sign(value: string, secret: string): string {
  return createHmac("sha256", secret).update(value).digest("base64url");
}

function constantTimeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

function base64UrlEncode(buffer: Buffer): string {
  return buffer.toString("base64url");
}

function base64UrlDecode(value: string): Buffer {
  return Buffer.from(value, "base64url");
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function parseCsv(value: string | undefined): string[] {
  return (value ?? "admin@example.gov")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}
