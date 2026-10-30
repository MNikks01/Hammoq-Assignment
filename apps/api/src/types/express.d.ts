import type { AuthContext } from '../middleware/authenticate';

declare global {
  namespace Express {
    interface Request {
      /** Set by the authenticate middleware from the verified access token. */
      auth?: AuthContext;
    }
  }
}

export {};
