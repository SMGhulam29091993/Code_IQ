import { Router } from "express";
import { authRoutes } from "../modules/auth/auth.routes";

// Each module mounts itself here as it's built — see .ai/plans/backend.md.
export const router = Router();

router.use("/auth", authRoutes);
