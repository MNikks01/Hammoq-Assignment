import type { ChangePasswordInput, LoginInput, RegisterInput, UserDto } from '@taskmanager/contracts';
import { changePasswordSchema, loginSchema, registerSchema } from '@taskmanager/contracts';
import type { Types } from 'mongoose';
import type { Config } from '../../config/env';
import { logger } from '../../observability/logger';
import { authEvents } from '../../observability/metrics';
import { randomToken, sha256 } from '../../utils/crypto';
import { AppError, Errors } from '../../utils/errors';
import { Task } from '../tasks/task.model';
import { toUserDto, User } from '../users/user.model';
import type { IssuedTokens } from './cookies';
import { hashPassword, needsRehash, verifyAgainstDummy, verifyPassword } from './password';
import { Session } from './session.model';
import type { TokenService } from './tokens';

export interface ClientMeta {
  userAgent?: string;
}

/** Concurrent refreshes (two tabs) within this window are not treated as token theft. */
const ROTATION_GRACE_MS = 10_000;

export function createAuthService(config: Config, tokens: TokenService) {
  async function issueSession(
    userId: Types.ObjectId,
    meta: ClientMeta,
    family?: { familyId: string; absoluteExpiresAt: Date },
  ): Promise<IssuedTokens> {
    const refreshToken = randomToken(32);
    const now = Date.now();
    const absoluteExpiresAt = family?.absoluteExpiresAt ?? new Date(now + config.SESSION_ABSOLUTE_TTL * 1000);
    const expiresAt = new Date(Math.min(now + config.REFRESH_TOKEN_TTL * 1000, absoluteExpiresAt.getTime()));
    const session = await Session.create({
      userId,
      familyId: family?.familyId ?? randomToken(16),
      tokenHash: sha256(refreshToken),
      expiresAt,
      absoluteExpiresAt,
      userAgent: (meta.userAgent ?? '').slice(0, 256),
    });
    const accessToken = await tokens.signAccess({ sub: String(userId), sid: String(session._id) });
    return { accessToken, refreshToken, refreshExpiresAt: expiresAt };
  }

  return {
    async register(raw: RegisterInput, meta: ClientMeta): Promise<{ user: UserDto; tokens: IssuedTokens }> {
      const input = registerSchema.parse(raw);
      const passwordHash = await hashPassword(input.password);
      let user;
      try {
        user = await User.create({ name: input.name, email: input.email, passwordHash });
      } catch (err) {
        if ((err as { code?: number }).code === 11000) {
          // Registration necessarily reveals that an address is taken; this endpoint is
          // rate limited per IP to keep enumeration slow (see docs/security.md).
          throw Errors.conflict('An account with this email already exists');
        }
        throw err;
      }
      authEvents.inc({ event: 'register' });
      return { user: toUserDto(user), tokens: await issueSession(user._id, meta) };
    },

    async login(raw: LoginInput, meta: ClientMeta): Promise<{ user: UserDto; tokens: IssuedTokens }> {
      const input = loginSchema.parse(raw);
      const user = await User.findOne({ email: input.email }).select('+passwordHash');
      if (!user) {
        await verifyAgainstDummy(input.password);
        authEvents.inc({ event: 'login_failure' });
        throw Errors.invalidCredentials();
      }
      if (!(await verifyPassword(user.passwordHash, input.password))) {
        authEvents.inc({ event: 'login_failure' });
        throw Errors.invalidCredentials();
      }
      if (needsRehash(user.passwordHash)) {
        user.passwordHash = await hashPassword(input.password);
        await user.save();
      }
      authEvents.inc({ event: 'login_success' });
      return { user: toUserDto(user), tokens: await issueSession(user._id, meta) };
    },

    async refresh(
      rawToken: string | undefined,
      meta: ClientMeta,
    ): Promise<{ user: UserDto; tokens: IssuedTokens }> {
      if (!rawToken || rawToken.length > 128) throw Errors.unauthenticated();
      const now = new Date();
      const session = await Session.findOne({ tokenHash: sha256(rawToken) }).lean();
      if (!session || session.revokedAt) throw Errors.unauthenticated();

      if (session.replacedAt) {
        if (now.getTime() - session.replacedAt.getTime() > ROTATION_GRACE_MS) {
          // A rotated token was replayed: assume theft and kill the whole family.
          await Session.updateMany(
            { familyId: session.familyId, revokedAt: null },
            { $set: { revokedAt: now } },
          );
          authEvents.inc({ event: 'refresh_reuse' });
          logger.warn(
            { userId: String(session.userId) },
            'refresh token reuse detected; session family revoked',
          );
        }
        throw Errors.unauthenticated();
      }
      if (session.expiresAt <= now || session.absoluteExpiresAt <= now) throw Errors.unauthenticated();

      // Atomically claim the token so two concurrent refreshes cannot both succeed.
      const claimed = await Session.findOneAndUpdate(
        { _id: session._id, replacedAt: null, revokedAt: null },
        { $set: { replacedAt: now } },
      ).lean();
      if (!claimed) throw Errors.unauthenticated();

      const user = await User.findById(session.userId).lean();
      if (!user) throw Errors.unauthenticated();

      authEvents.inc({ event: 'refresh' });
      const issued = await issueSession(user._id, meta, {
        familyId: session.familyId,
        absoluteExpiresAt: session.absoluteExpiresAt,
      });
      return { user: toUserDto(user), tokens: issued };
    },

    async logout(rawToken: string | undefined): Promise<void> {
      if (!rawToken || rawToken.length > 128) return;
      const session = await Session.findOne({ tokenHash: sha256(rawToken) }, { familyId: 1 }).lean();
      if (session) {
        await Session.updateMany(
          { familyId: session.familyId, revokedAt: null },
          { $set: { revokedAt: new Date() } },
        );
        authEvents.inc({ event: 'logout' });
      }
    },

    async me(userId: string): Promise<UserDto> {
      const user = await User.findById(userId).lean();
      if (!user) throw Errors.unauthenticated();
      return toUserDto(user);
    },

    async changePassword(
      userId: string,
      raw: ChangePasswordInput,
      meta: ClientMeta,
    ): Promise<{ user: UserDto; tokens: IssuedTokens }> {
      const input = changePasswordSchema.parse(raw);
      const user = await User.findById(userId).select('+passwordHash');
      if (!user) throw Errors.unauthenticated();
      if (!(await verifyPassword(user.passwordHash, input.currentPassword))) {
        throw new AppError(400, 'VALIDATION_ERROR', 'Current password is incorrect', [
          { path: 'currentPassword', message: 'Current password is incorrect' },
        ]);
      }
      user.passwordHash = await hashPassword(input.newPassword);
      user.passwordChangedAt = new Date();
      await user.save();
      // Sign out every other device; the caller gets a fresh session.
      await Session.updateMany({ userId: user._id, revokedAt: null }, { $set: { revokedAt: new Date() } });
      return { user: toUserDto(user), tokens: await issueSession(user._id, meta) };
    },

    /**
     * Hard delete. Order matters without a transaction: revoke sessions first so a
     * partially completed deletion can never leave a usable login behind; a retry
     * finishes the job because every step is idempotent.
     */
    async deleteAccount(userId: string, password: string): Promise<void> {
      const user = await User.findById(userId).select('+passwordHash');
      if (!user) throw Errors.unauthenticated();
      if (!(await verifyPassword(user.passwordHash, password))) {
        throw new AppError(400, 'VALIDATION_ERROR', 'Password is incorrect', [
          { path: 'password', message: 'Password is incorrect' },
        ]);
      }
      await Session.deleteMany({ userId: user._id });
      await Task.deleteMany({ userId: user._id });
      await User.deleteOne({ _id: user._id });
    },
  };
}

export type AuthService = ReturnType<typeof createAuthService>;
