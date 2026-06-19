import { create } from "zustand";

import { api, ApiError, getToken, setToken, type ApiUser } from "./api";

export type Role = "Owner" | "Admin" | "Member";

// Per-page access. A member's `permissions` maps page-key -> level; pages absent
// from the map are not accessible. Owners have implicit full ("edit") access.
export type PageAccess = "view" | "edit";
export type Permissions = Record<string, PageAccess>;

export interface Access {
  isOwner: boolean;
  role: Role;
  permissions: Permissions;
}

export interface Organization {
  id: string;
  name: string;
  description: string;
  createdAt: string;
  ownerId: string;
}

export interface TeamMember {
  id: string;
  name: string;
  email: string;
  role: Role;
  status: "Active" | "Invited";
  permissions: Permissions;
}

export interface Note {
  id: string;
  date: string; // YYYY-MM-DD
  content: string;
  createdAt: string;
  updatedAt: string;
}

export interface BoxTask {
  id: string;
  text: string;
  done: boolean;
}

export interface Box {
  id: string;
  title: string;
  content: string;
  tasks: BoxTask[];
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
}

export interface BoardSummary {
  id: string;
  date: string; // YYYY-MM-DD
  title: string;
  createdAt: string;
  updatedAt: string;
  boxCount: number;
  openTaskCount: number; // tasks not yet done, across all boxes
}

export interface BoardDetail {
  id: string;
  date: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  boxes: Box[];
}

export type Schedule = "Daily" | "Weekly" | "Biweekly" | "Monthly" | "Yearly";
export type SectionType = "text" | "bulleted" | "numbered";

export interface MeetingItem {
  id: string;
  text: string;
  level: number; // 0 = top-level, 1 = sub-item
}

export interface MeetingSection {
  id: string;
  title: string;
  type: SectionType;
  body: string; // used when type === "text"
  items: MeetingItem[];
}

export interface MeetingSummary {
  id: string;
  name: string;
  date: string; // YYYY-MM-DD
  schedule: Schedule;
  duration: string;
  sectionCount: number;
  sections: MeetingSection[];
  createdAt: string;
  updatedAt: string;
}

export interface MeetingDetail {
  id: string;
  name: string;
  date: string; // YYYY-MM-DD
  schedule: Schedule;
  duration: string;
  sections: MeetingSection[];
  createdAt: string;
  updatedAt: string;
}

export interface MeetingInput {
  name: string;
  date: string; // YYYY-MM-DD
  schedule: Schedule;
  duration?: string;
  sections?: MeetingSection[];
}

// ---- Templates ----
export type TemplateKind = "board" | "meeting";

export interface BoardTemplateData {
  boxes: Box[];
}

export interface MeetingTemplateData {
  schedule: Schedule;
  duration: string;
  sections: MeetingSection[];
}

export interface Template {
  id: string;
  kind: TemplateKind;
  name: string;
  data: BoardTemplateData | MeetingTemplateData;
  createdAt: string;
  updatedAt: string;
}

export interface TemplateInput {
  kind: TemplateKind;
  name: string;
  data: BoardTemplateData | MeetingTemplateData;
}

// Hydration lifecycle. Components must wait for "ready" before deciding to
// redirect, otherwise a valid session would briefly look logged-out on load.
export type Status = "idle" | "loading" | "ready";

interface AuthResult {
  ok: boolean;
  error?: string;
}

interface AppState {
  token: string | null;
  currentUser: ApiUser | null;
  organization: Organization | null;
  access: Access | null;
  team: TeamMember[];
  notes: Note[];
  boards: BoardSummary[];
  meetings: MeetingSummary[];
  templates: Template[];
  status: Status;

  // Lifecycle
  bootstrap: () => Promise<void>;
  refreshOrgData: () => Promise<void>;
  refreshBoards: () => Promise<void>;
  refreshMeetings: () => Promise<void>;
  refreshTemplates: () => Promise<void>;

  // Boards
  createBoard: (date: string, title?: string) => Promise<BoardDetail>;
  renameBoard: (id: string, title: string) => Promise<void>;
  copyBoard: (id: string, date: string, title?: string) => Promise<void>;
  deleteBoard: (id: string) => Promise<void>;

  // Meetings
  createMeeting: (input: MeetingInput) => Promise<MeetingDetail>;
  renameMeeting: (id: string, name: string) => Promise<void>;
  deleteMeeting: (id: string) => Promise<void>;

  // Templates
  createTemplate: (input: TemplateInput) => Promise<Template>;
  updateTemplate: (id: string, patch: Partial<Pick<Template, "name" | "data">>) => Promise<void>;
  deleteTemplate: (id: string) => Promise<void>;

  // Auth
  signup: (name: string, email: string, password: string) => Promise<AuthResult>;
  login: (email: string, password: string) => Promise<AuthResult>;
  loginWithGoogle: (credential?: string) => Promise<AuthResult>;
  logout: () => void;

  // Organization
  createOrg: (name: string, description: string) => Promise<void>;
  updateOrg: (name: string, description: string) => Promise<void>;
  deleteOrg: () => Promise<void>;

  // Team
  inviteMember: (
    name: string,
    email: string,
    role: Role,
    permissions: Permissions,
  ) => Promise<void>;
  removeMember: (id: string) => Promise<void>;
  updateMemberRole: (id: string, role: Role) => Promise<void>;
  updateMemberPermissions: (id: string, permissions: Permissions) => Promise<void>;

  // Notes
  saveNote: (date: string, content: string, id?: string) => Promise<void>;
  deleteNote: (id: string) => Promise<void>;

  // Profile
  updateProfile: (name: string, email: string, password?: string) => Promise<void>;
}

const errMsg = (e: unknown, fallback: string) => (e instanceof ApiError ? e.message : fallback);

export const useStore = create<AppState>((set, get) => ({
  token: null,
  currentUser: null,
  organization: null,
  access: null,
  team: [],
  notes: [],
  boards: [],
  meetings: [],
  templates: [],
  status: "idle",

  bootstrap: async () => {
    const token = getToken();
    if (!token) {
      set({ token: null, status: "ready" });
      return;
    }
    set({ token, status: "loading" });
    try {
      const user = await api.me();
      set({ currentUser: user });
      await get().refreshOrgData();
    } catch {
      // Token invalid/expired — clear the session.
      setToken(null);
      set({
        token: null,
        currentUser: null,
        organization: null,
        access: null,
        team: [],
        notes: [],
        boards: [],
        meetings: [],
        templates: [],
      });
    } finally {
      set({ status: "ready" });
    }
  },

  refreshOrgData: async () => {
    const [org, access] = await Promise.all([
      api.getOrganization(),
      // Never let an access-fetch failure (e.g. old backend) break login —
      // default to full owner access.
      api.getAccess().catch((): Access => ({ isOwner: true, role: "Owner", permissions: {} })),
    ]);
    set({ access });
    if (!org) {
      set({ organization: null, team: [], notes: [], boards: [], meetings: [], templates: [] });
      return;
    }
    const [team, notes, boards, meetings, templates] = await Promise.all([
      api.getTeam(),
      api.getNotes(),
      api.getBoards(),
      api.getMeetings(),
      // Templates are a non-critical enhancement — never let a missing/old
      // backend route (404) reject the whole load and clear the session.
      api.getTemplates().catch(() => []),
    ]);
    set({ organization: org, team, notes, boards, meetings, templates });
  },

  refreshBoards: async () => {
    set({ boards: await api.getBoards() });
  },

  refreshMeetings: async () => {
    set({ meetings: await api.getMeetings() });
  },

  refreshTemplates: async () => {
    set({ templates: await api.getTemplates() });
  },

  createBoard: async (date, title) => {
    const board = await api.createBoard(date, title);
    await get().refreshBoards();
    return board;
  },

  renameBoard: async (id, title) => {
    const updated = await api.renameBoard(id, title);
    set((s) => ({ boards: s.boards.map((b) => (b.id === id ? updated : b)) }));
  },

  copyBoard: async (id, date, title) => {
    await api.copyBoard(id, date, title);
    await get().refreshBoards();
  },

  deleteBoard: async (id) => {
    await api.deleteBoard(id);
    set((s) => ({ boards: s.boards.filter((b) => b.id !== id) }));
  },

  createMeeting: async (input) => {
    const meeting = await api.createMeeting(input);
    await get().refreshMeetings();
    return meeting;
  },

  renameMeeting: async (id, name) => {
    const updated = await api.updateMeeting(id, { name });
    set((s) => ({
      meetings: s.meetings.map((m) =>
        m.id === id
          ? { ...m, name: updated.name, schedule: updated.schedule, duration: updated.duration }
          : m,
      ),
    }));
  },

  deleteMeeting: async (id) => {
    await api.deleteMeeting(id);
    set((s) => ({ meetings: s.meetings.filter((m) => m.id !== id) }));
  },

  createTemplate: async (input) => {
    const template = await api.createTemplate(input);
    set((s) => ({ templates: [template, ...s.templates] }));
    return template;
  },

  updateTemplate: async (id, patch) => {
    const updated = await api.updateTemplate(id, patch);
    set((s) => ({ templates: s.templates.map((t) => (t.id === id ? updated : t)) }));
  },

  deleteTemplate: async (id) => {
    await api.deleteTemplate(id);
    set((s) => ({ templates: s.templates.filter((t) => t.id !== id) }));
  },

  signup: async (name, email, password) => {
    try {
      const { token, user } = await api.signup(name, email, password);
      setToken(token);
      set({
        token,
        currentUser: user,
        organization: null,
        access: null,
        team: [],
        notes: [],
        boards: [],
        meetings: [],
        templates: [],
        status: "ready",
      });
      return { ok: true };
    } catch (e) {
      return { ok: false, error: errMsg(e, "Signup failed") };
    }
  },

  login: async (email, password) => {
    try {
      const { token, user } = await api.login(email, password);
      setToken(token);
      set({ token, currentUser: user });
      await get().refreshOrgData();
      set({ status: "ready" });
      return { ok: true };
    } catch (e) {
      return { ok: false, error: errMsg(e, "Login failed") };
    }
  },

  loginWithGoogle: async (credential) => {
    try {
      const { token, user } = await api.loginWithGoogle(credential);
      setToken(token);
      set({ token, currentUser: user });
      await get().refreshOrgData();
      set({ status: "ready" });
      return { ok: true };
    } catch (e) {
      return { ok: false, error: errMsg(e, "Google sign-in failed") };
    }
  },

  logout: () => {
    void api.logout().catch(() => {});
    setToken(null);
    set({
      token: null,
      currentUser: null,
      organization: null,
      team: [],
      notes: [],
      boards: [],
      meetings: [],
      status: "ready",
    });
  },

  createOrg: async (name, description) => {
    const org = await api.createOrg(name, description);
    const team = await api.getTeam();
    set({ organization: org, team, notes: [] });
  },

  updateOrg: async (name, description) => {
    const org = await api.updateOrg(name, description);
    set({ organization: org });
  },

  deleteOrg: async () => {
    await api.deleteOrg();
    set({ organization: null, team: [], notes: [] });
  },

  inviteMember: async (name, email, role, permissions) => {
    const member = await api.inviteMember(name, email, role, permissions);
    set((s) => ({ team: [...s.team, member] }));
  },

  removeMember: async (id) => {
    await api.removeMember(id);
    set((s) => ({ team: s.team.filter((m) => m.id !== id) }));
  },

  updateMemberRole: async (id, role) => {
    const member = await api.updateMember(id, { role });
    set((s) => ({ team: s.team.map((m) => (m.id === id ? member : m)) }));
  },

  updateMemberPermissions: async (id, permissions) => {
    const member = await api.updateMember(id, { permissions });
    set((s) => ({ team: s.team.map((m) => (m.id === id ? member : m)) }));
  },

  saveNote: async (date, content, id) => {
    if (id) {
      const note = await api.updateNote(id, content);
      set((s) => ({ notes: s.notes.map((n) => (n.id === id ? note : n)) }));
    } else {
      const note = await api.createNote(date, content);
      set((s) => ({ notes: [...s.notes, note] }));
    }
  },

  deleteNote: async (id) => {
    await api.deleteNote(id);
    set((s) => ({ notes: s.notes.filter((n) => n.id !== id) }));
  },

  updateProfile: async (name, email, password) => {
    const user = await api.updateProfile(name, email, password);
    set({ currentUser: user });
  },
}));

export const useCurrentUser = (): ApiUser | null => useStore((s) => s.currentUser);

/** Effective access level for a page key. Owners (and pre-load) get "edit". */
export const levelFor = (access: Access | null, pageKey: string): "none" | PageAccess => {
  if (!access || access.isOwner) return "edit";
  return access.permissions[pageKey] ?? "none";
};

/** Hook: the current user's access level for a page ("none" | "view" | "edit"). */
export const usePageAccess = (pageKey: string): "none" | PageAccess =>
  useStore((s) => levelFor(s.access, pageKey));
