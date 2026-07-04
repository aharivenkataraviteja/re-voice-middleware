import jwt from "jsonwebtoken";
import bcrypt from "bcrypt";
import { config } from "../config";

const ACCESS_TOKEN_TTL = "15m";
const REFRESH_TOKEN_TTL = "7d";
const BCRYPT_ROUNDS = 12;

export interface AccessTokenClaims {
  sub: string; // user id
  tenantId: string;
  role: "admin" | "manager" | "agent";
  type: "access";
}

export interface RefreshTokenClaims {
  sub: string;
  tenantId: string;
  type: "refresh";
}

export function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

export function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export function signAccessToken(claims: Omit<AccessTokenClaims, "type">): string {
  return jwt.sign({ ...claims, type: "access" }, config.jwtPrivateKey, {
    algorithm: "RS256",
    expiresIn: ACCESS_TOKEN_TTL,
  });
}

export function signRefreshToken(claims: Omit<RefreshTokenClaims, "type">): string {
  return jwt.sign({ ...claims, type: "refresh" }, config.jwtPrivateKey, {
    algorithm: "RS256",
    expiresIn: REFRESH_TOKEN_TTL,
  });
}

export function verifyAccessToken(token: string): AccessTokenClaims {
  const decoded = jwt.verify(token, config.jwtPublicKey, { algorithms: ["RS256"] }) as AccessTokenClaims;
  if (decoded.type !== "access") {
    throw new Error("Not an access token");
  }
  return decoded;
}

export function verifyRefreshToken(token: string): RefreshTokenClaims {
  const decoded = jwt.verify(token, config.jwtPublicKey, { algorithms: ["RS256"] }) as RefreshTokenClaims;
  if (decoded.type !== "refresh") {
    throw new Error("Not a refresh token");
  }
  return decoded;
}
