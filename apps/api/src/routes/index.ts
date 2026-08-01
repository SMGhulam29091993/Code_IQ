import { Router } from "express";

// Each module mounts itself here as it's built — see .ai/plans/backend.md.
// e.g. router.use('/auth', authRoutes) lands in Step 2.
export const router = Router();
