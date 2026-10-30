import { jwtVerify, SignJWT } from 'jose';
import type { Config } from '../../config/env';

const ISSUER = 'task-api';
const AUDIENCE = 'task-web';
const OBJECT_ID = /^[a-f0-9]{24}$/;

export interface AccessClaims {
  sub: string;
  sid: string;
}

export function createTokenService(config: Config) {
  const key = new TextEncoder().encode(config.ACCESS_TOKEN_SECRET);

  return {
    async signAccess(claims: AccessClaims): Promise<string> {
      return new SignJWT({ sid: claims.sid })
        .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
        .setSubject(claims.sub)
        .setIssuer(ISSUER)
        .setAudience(AUDIENCE)
        .setIssuedAt()
        .setExpirationTime(`${config.ACCESS_TOKEN_TTL}s`)
        .sign(key);
    },

    async verifyAccess(token: string): Promise<AccessClaims> {
      const { payload } = await jwtVerify(token, key, {
        algorithms: ['HS256'],
        issuer: ISSUER,
        audience: AUDIENCE,
        clockTolerance: 5,
      });
      if (
        typeof payload.sub !== 'string' ||
        !OBJECT_ID.test(payload.sub) ||
        typeof payload.sid !== 'string'
      ) {
        throw new Error('Malformed token claims');
      }
      return { sub: payload.sub, sid: payload.sid };
    },
  };
}

export type TokenService = ReturnType<typeof createTokenService>;
