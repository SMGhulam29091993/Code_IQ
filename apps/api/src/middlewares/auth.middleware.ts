import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { env } from "../lib/env";
import { prisma } from "../lib/prisma";
import { fail } from "../lib/response";

// Exact behaviour from .ai/knowledge/domains/auth.md "Shared auth middleware".
export async function authMiddleware(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    return res.status(401).json(fail("Missing or malformed authorization header"));
  }

  const token = header.split(" ")[1];
  if (!token) {
    return res.status(401).json(fail("Missing or malformed authorization header"));
  }

  let payload: { sub: string };
  try {
    payload = jwt.verify(token, env.JWT_SECRET) as { sub: string };
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      return res.status(401).json(fail("Token expired"));
    }
    return res.status(401).json(fail("Invalid token"));
  }

  const user = await prisma.user.findUnique({ where: { id: payload.sub } });
  if (!user) {
    return res.status(401).json(fail("User not found"));
  }

  req.user = user;
  next();
}
