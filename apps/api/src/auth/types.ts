import type { Role } from "@remix-hub/core";
import type { FastifyReply, FastifyRequest } from "fastify";

/** JWT payload carried in the bearer token. */
export interface AuthClaims {
  sub: string; // user_id
  role: Role;
}

type PreHandler = (req: FastifyRequest, reply: FastifyReply) => Promise<unknown>;

declare module "fastify" {
  interface FastifyRequest {
    /** Set by the `authenticate` preHandler after verifying the JWT. */
    authUser?: AuthClaims;
  }
  interface FastifyInstance {
    authenticate: PreHandler;
    requireRole: (...roles: Role[]) => PreHandler;
  }
}

declare module "@fastify/jwt" {
  interface FastifyJWT {
    payload: AuthClaims;
    user: AuthClaims;
  }
}
