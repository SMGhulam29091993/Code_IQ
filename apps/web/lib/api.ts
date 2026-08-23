import axios from "axios";
import { useAuthStore } from "@/store/auth.store";

// Pattern from .ai/knowledge/technical/frontend/state-conventions.md "Axios instance".
export const api = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL + "/api",
  headers: { "Content-Type": "application/json" },
});

api.interceptors.request.use((config) => {
  const token = useAuthStore.getState().token;
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

interface QueuedRequest {
  resolve: (token: string) => void;
  reject: (error: unknown) => void;
}

let isRefreshing = false;
let failedQueue: QueuedRequest[] = [];

function processQueue(error: unknown, token: string | null) {
  failedQueue.forEach(({ resolve, reject }) => {
    if (error || !token) reject(error);
    else resolve(token);
  });
  failedQueue = [];
}

// A 401 from one of these is a direct credential/token failure (wrong password, expired OTP
// session, dead refresh token), not "access token expired mid-session" — there's no access
// token to refresh in the first place, and refresh-and-retry would just misreport it (e.g. a
// wrong-password login attempt getting reported as "session expired" instead of showing the
// real error). Let it propagate so the calling form's own onError handles it.
const PUBLIC_AUTH_PATHS = /^\/auth\/(login|register|verify-otp|refresh)(\/|$)/;

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const original = error.config;
    const isPublicAuthCall = PUBLIC_AUTH_PATHS.test(original?.url ?? "");
    if (error.response?.status === 401 && !original._retry && !isPublicAuthCall) {
      original._retry = true;
      if (isRefreshing) {
        return new Promise<string>((resolve, reject) => failedQueue.push({ resolve, reject })).then(
          (token) => {
            original.headers.Authorization = `Bearer ${token}`;
            return api(original);
          }
        );
      }
      isRefreshing = true;
      try {
        const refreshToken = useAuthStore.getState().refreshToken;
        const { data } = await axios.post(
          `${process.env.NEXT_PUBLIC_API_URL}/api/auth/refresh`,
          { refreshToken }
        );
        useAuthStore.getState().setToken(data.data.token);
        processQueue(null, data.data.token);
        original.headers.Authorization = `Bearer ${data.data.token}`;
        return api(original);
      } catch (refreshError) {
        processQueue(refreshError, null);
        useAuthStore.getState().logout();
        window.location.href = "/login?reason=session_expired";
        return Promise.reject(refreshError);
      } finally {
        isRefreshing = false;
      }
    }
    return Promise.reject(error);
  }
);
