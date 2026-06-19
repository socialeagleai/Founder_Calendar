// Typed client for the Founder Calendar FastAPI backend.
//
// The app currently keeps all state in the localStorage Zustand store
// (`src/lib/store.ts`). This client exposes the exact same operations backed by
// the real API so you can migrate incrementally:
//
//   1. Ensure the backend is running (see backend/README.md) and that
//      VITE_API_URL points at it (configured in frontend/.env).
//   2. Replace the body of each store action in store.ts with the matching
//      `api.*` call (they are async), persisting only `token` + `currentUser`
//      locally instead of the whole dataset.
//
// All backend responses are camelCase and line up with the types in store.ts.

import type {
  Access,
  BoardDetail,
  BoardSummary,
  AppNotification,
  Box,
  Invitation,
  LeaveRequest,
  MeetingDetail,
  MeetingInput,
  MeetingSummary,
  Note,
  Organization,
  OrgMembership,
  Permissions,
  Role,
  TeamMember,
  Template,
  TemplateInput,
  TemplateKind,
} from "./store";

const BASE_URL = import.meta.env.VITE_API_URL ?? "http://127.0.0.1:8000";
const TOKEN_KEY = "founder-calendar-token";
const ACTIVE_ORG_KEY = "founder-calendar-active-org";

export interface ApiUser {
  id: string;
  name: string;
  email: string;
}

export interface AuthResult {
  token: string;
  user: ApiUser;
}

export function getToken(): string | null {
  if (typeof localStorage === "undefined") return null;
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string | null) {
  if (typeof localStorage === "undefined") return;
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

/** The organization the app is currently scoped to (sent as X-Org-Id). */
export function getActiveOrgId(): string | null {
  if (typeof localStorage === "undefined") return null;
  return localStorage.getItem(ACTIVE_ORG_KEY);
}

export function setActiveOrgId(id: string | null) {
  if (typeof localStorage === "undefined") return;
  if (id) localStorage.setItem(ACTIVE_ORG_KEY, id);
  else localStorage.removeItem(ACTIVE_ORG_KEY);
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = "ApiError";
  }
}

async function request<T>(
  path: string,
  options: { method?: string; body?: unknown; auth?: boolean } = {},
): Promise<T> {
  const { method = "GET", body, auth = true } = options;
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (auth) {
    const token = getToken();
    if (token) headers["Authorization"] = `Bearer ${token}`;
    // Scope the request to the active organization, if one is selected.
    const orgId = getActiveOrgId();
    if (orgId) headers["X-Org-Id"] = orgId;
  }

  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (res.status === 204) return undefined as T;

  const text = await res.text();
  const data = text ? JSON.parse(text) : null;

  if (!res.ok) {
    const detail = (data && (data.detail || data.message)) || `Request failed (${res.status})`;
    throw new ApiError(res.status, typeof detail === "string" ? detail : "Request failed");
  }
  return data as T;
}

export const api = {
  // ---- auth ----
  signup: (name: string, email: string, password: string) =>
    request<AuthResult>("/api/auth/signup", {
      method: "POST",
      body: { name, email, password },
      auth: false,
    }),

  login: (email: string, password: string) =>
    request<AuthResult>("/api/auth/login", {
      method: "POST",
      body: { email, password },
      auth: false,
    }),

  // Pass a Google ID token as `credential`, or omit for demo Google login.
  loginWithGoogle: (credential?: string) =>
    request<AuthResult>("/api/auth/google", { method: "POST", body: { credential }, auth: false }),

  forgotPassword: (email: string) =>
    request<{ detail: string }>("/api/auth/forgot-password", {
      method: "POST",
      body: { email },
      auth: false,
    }),

  resetPassword: (token: string, password: string) =>
    request<{ detail: string }>("/api/auth/reset-password", {
      method: "POST",
      body: { token, password },
      auth: false,
    }),

  me: () => request<ApiUser>("/api/auth/me"),

  getAccess: () => request<Access>("/api/auth/access"),

  logout: () => request<void>("/api/auth/logout", { method: "POST" }),

  updateProfile: (name: string, email: string, password?: string) =>
    request<ApiUser>("/api/auth/profile", { method: "PATCH", body: { name, email, password } }),

  // ---- organization ----
  getOrganization: () => request<Organization | null>("/api/organization"),

  // Every org the user belongs to (owned + accepted memberships) — for the switcher.
  getOrganizations: () => request<OrgMembership[]>("/api/organizations"),

  createOrg: (name: string, description: string) =>
    request<Organization>("/api/organization", { method: "POST", body: { name, description } }),

  // Member requests to leave the active organization (owner approves).
  leaveOrganization: () =>
    request<{ detail: string }>("/api/organization/leave", { method: "POST" }),

  updateOrg: (name: string, description: string) =>
    request<Organization>("/api/organization", { method: "PATCH", body: { name, description } }),

  deleteOrg: () => request<void>("/api/organization", { method: "DELETE" }),

  // ---- team ----
  getTeam: () => request<TeamMember[]>("/api/team"),

  inviteMember: (name: string, email: string, role: Role, permissions: Permissions) =>
    request<TeamMember>("/api/team", {
      method: "POST",
      body: { name, email, role, permissions },
    }),

  updateMember: (id: string, patch: { role?: Role; permissions?: Permissions }) =>
    request<TeamMember>(`/api/team/${id}`, { method: "PATCH", body: patch }),

  removeMember: (id: string) => request<void>(`/api/team/${id}`, { method: "DELETE" }),

  // ---- invitations ----
  getInvitations: () => request<Invitation[]>("/api/invitations"),

  acceptInvitation: (id: string) =>
    request<Invitation>(`/api/invitations/${id}/accept`, { method: "POST" }),

  declineInvitation: (id: string) =>
    request<void>(`/api/invitations/${id}/decline`, { method: "POST" }),

  // ---- leave requests (owner-facing) ----
  getLeaveRequests: () => request<LeaveRequest[]>("/api/leave-requests"),

  acceptLeaveRequest: (memberId: string) =>
    request<void>(`/api/leave-requests/${memberId}/accept`, { method: "POST" }),

  declineLeaveRequest: (memberId: string) =>
    request<void>(`/api/leave-requests/${memberId}/decline`, { method: "POST" }),

  // ---- notifications (in-app messages) ----
  getNotifications: () => request<AppNotification[]>("/api/notifications"),

  dismissNotification: (id: string) =>
    request<void>(`/api/notifications/${id}/dismiss`, { method: "POST" }),

  // ---- notes ----
  getNotes: () => request<Note[]>("/api/notes"),

  createNote: (date: string, content: string) =>
    request<Note>("/api/notes", { method: "POST", body: { date, content } }),

  updateNote: (id: string, content: string) =>
    request<Note>(`/api/notes/${id}`, { method: "PUT", body: { content } }),

  deleteNote: (id: string) => request<void>(`/api/notes/${id}`, { method: "DELETE" }),

  // ---- boards ----
  // scope "mine" (default) = the caller's own boards; "org" = every member's
  // boards for the shared calendar.
  getBoards: (scope: "mine" | "org" = "mine") =>
    request<BoardSummary[]>(`/api/boards?scope=${scope}`),

  createBoard: (date: string, title?: string) =>
    request<BoardDetail>("/api/boards", { method: "POST", body: { date, title } }),

  getBoard: (id: string) => request<BoardDetail>(`/api/boards/${id}`),

  renameBoard: (id: string, title: string) =>
    request<BoardSummary>(`/api/boards/${id}`, { method: "PATCH", body: { title } }),

  deleteBoard: (id: string) => request<void>(`/api/boards/${id}`, { method: "DELETE" }),

  shareBoard: (id: string) =>
    request<{ token: string }>(`/api/boards/${id}/share`, { method: "POST" }),

  copyBoard: (id: string, date: string, title?: string) =>
    request<BoardSummary>(`/api/boards/${id}/copy`, { method: "POST", body: { date, title } }),

  getSharedBoard: (token: string) => request<BoardDetail>(`/api/shared/boards/${token}`),

  addBox: (boardId: string, box: Partial<Omit<Box, "id">>) =>
    request<Box>(`/api/boards/${boardId}/boxes`, { method: "POST", body: box }),

  updateBox: (boxId: string, patch: Partial<Omit<Box, "id">>) =>
    request<Box>(`/api/boxes/${boxId}`, { method: "PATCH", body: patch }),

  deleteBox: (boxId: string) => request<void>(`/api/boxes/${boxId}`, { method: "DELETE" }),

  // ---- meetings ----
  // scope "mine" (default) = the caller's own meetings; "org" = every member's
  // meetings for the shared calendar.
  getMeetings: (scope: "mine" | "org" = "mine") =>
    request<MeetingSummary[]>(`/api/meetings?scope=${scope}`),

  createMeeting: (input: MeetingInput) =>
    request<MeetingDetail>("/api/meetings", { method: "POST", body: input }),

  getMeeting: (id: string) => request<MeetingDetail>(`/api/meetings/${id}`),

  updateMeeting: (id: string, patch: Partial<MeetingInput>) =>
    request<MeetingDetail>(`/api/meetings/${id}`, { method: "PATCH", body: patch }),

  deleteMeeting: (id: string) => request<void>(`/api/meetings/${id}`, { method: "DELETE" }),

  // ---- templates ----
  getTemplates: (kind?: TemplateKind) =>
    request<Template[]>(`/api/templates${kind ? `?kind=${kind}` : ""}`),

  createTemplate: (input: TemplateInput) =>
    request<Template>("/api/templates", { method: "POST", body: input }),

  updateTemplate: (id: string, patch: Partial<Pick<Template, "name" | "data">>) =>
    request<Template>(`/api/templates/${id}`, { method: "PATCH", body: patch }),

  deleteTemplate: (id: string) => request<void>(`/api/templates/${id}`, { method: "DELETE" }),
};
