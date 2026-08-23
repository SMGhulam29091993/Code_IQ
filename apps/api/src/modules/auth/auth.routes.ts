import { Router } from "express";
import {
  ChangePasswordSchema,
  LoginSchema,
  LogoutSchema,
  RefreshSchema,
  RegisterSchema,
  UpdateProfileSchema,
  VerifyOtpSchema,
} from "./auth.validator";
import { authController } from "../../container";
import { authMiddleware } from "../../middlewares/auth.middleware";
import { authRateLimit } from "../../middlewares/rate-limit.middleware";
import { validate } from "../../middlewares/validate.middleware";

export const authRoutes = Router();

/**
 * @swagger
 * /auth/register:
 *   post:
 *     summary: Create a new user account and issue an email OTP
 *     tags: [Auth]
 */
authRoutes.post("/register", authRateLimit, validate(RegisterSchema), authController.register);

/**
 * @swagger
 * /auth/verify-otp:
 *   post:
 *     summary: Confirm the registration OTP and issue access/refresh tokens
 *     tags: [Auth]
 */
authRoutes.post(
  "/verify-otp",
  authRateLimit,
  validate(VerifyOtpSchema),
  authController.verifyOtp
);

/**
 * @swagger
 * /auth/login:
 *   post:
 *     summary: Authenticate a user and return access/refresh tokens
 *     tags: [Auth]
 */
authRoutes.post("/login", authRateLimit, validate(LoginSchema), authController.login);

/**
 * @swagger
 * /auth/refresh:
 *   post:
 *     summary: Issue a new access token from a valid refresh token
 *     tags: [Auth]
 */
authRoutes.post("/refresh", validate(RefreshSchema), authController.refresh);

/**
 * @swagger
 * /auth/logout:
 *   post:
 *     summary: Revoke a refresh token
 *     tags: [Auth]
 *     security:
 *       - bearerAuth: []
 */
authRoutes.post("/logout", authMiddleware, validate(LogoutSchema), authController.logout);

/**
 * @swagger
 * /auth/me:
 *   get:
 *     summary: Get the current user's profile
 *     tags: [Auth]
 *     security:
 *       - bearerAuth: []
 */
authRoutes.get("/me", authMiddleware, authController.getMe);

/**
 * @swagger
 * /auth/me:
 *   patch:
 *     summary: Update the current user's display name
 *     tags: [Auth]
 *     security:
 *       - bearerAuth: []
 */
authRoutes.patch(
  "/me",
  authMiddleware,
  validate(UpdateProfileSchema),
  authController.updateProfile
);

/**
 * @swagger
 * /auth/change-password:
 *   post:
 *     summary: Change the current user's password
 *     tags: [Auth]
 *     security:
 *       - bearerAuth: []
 */
authRoutes.post(
  "/change-password",
  authMiddleware,
  validate(ChangePasswordSchema),
  authController.changePassword
);
