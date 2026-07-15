import { create } from "zustand";

import {
  api,
  ApiError,
  getActiveOrgId,
  getToken,
  setActiveOrgId,
  setToken,
  type ApiUser,
} from "./api";

export type Role = "Owner" | "Admin" | "Member";

// Per-page access. A member's `permissions` maps page-key -> level; pages absent
// from the map are not accessible. Owners have implicit full ("edit") access.
export type PageAccess = "view" | "edit";
export type Permissions = Record<string, PageAccess>;

// Audience control shared by notes, boards and meetings. "everyone" = whole org;
// "departments"/"members" = only the listed departments/teammates; "private" =
// just the creator. The creator always sees their own item.
export type Visibility = "everyone" | "departments" | "members" | "private";

export interface Audience {
  visibility: Visibility;
  visibleDepartments: string[]; // department ids (when visibility === "departments")
  visibleMembers: string[]; // TeamMember ids (when visibility === "members")
}

/** The default audience for a brand-new item: visible to the whole org. */
export const EVERYONE_AUDIENCE: Audience = {
  visibility: "everyone",
  visibleDepartments: [],
  visibleMembers: [],
};

/** Pull just the audience fields off any item that carries them. */
export const audienceOf = (i: Audience): Audience => ({
  visibility: i.visibility,
  visibleDepartments: i.visibleDepartments ?? [],
  visibleMembers: i.visibleMembers ?? [],
});

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

/** An org the user belongs to, with their role in it - powers the switcher. */
export interface OrgMembership {
  id: string;
  name: string;
  description: string;
  createdAt: string;
  ownerId: string;
  role: Role;
  isOwner: boolean;
}

/** A pending invitation shown in the notification bell. */
export interface Invitation {
  id: string;
  organizationId: string;
  organizationName: string;
  role: Role;
  createdAt: string;
}

export type MemberStatus = "Active" | "Invited" | "LeaveRequested";

export interface TeamMember {
  id: string;
  name: string;
  email: string;
  /** What teammates type to mention them, without the "@" (e.g. "priya_nair"). */
  handle?: string;
  role: Role;
  status: MemberStatus;
  permissions: Permissions;
  departmentId?: string | null; // the team grouping this member belongs to
}

/** A team grouping inside an org (e.g. HR, Operations). */
export interface Department {
  id: string;
  name: string;
  createdAt: string;
}

/** A member's request to leave one of the owner's orgs (owner's notification). */
export interface LeaveRequest {
  id: string; // the TeamMember id
  organizationId: string;
  organizationName: string;
  memberName: string;
  memberEmail: string;
}

/** An in-app message for the current user (e.g. leave request approved/declined). */
export interface AppNotification {
  id: string;
  message: string;
  /** What produced it: system | shared | activity | mention | digest. */
  type: string;
  /** Relative path to open when clicked; "" means not clickable. */
  link: string;
  read: boolean;
  createdAt: string;
}

/** The current user's notification settings (Settings -> Preferences). */
export interface NotificationPrefs {
  sharedWithMe: boolean;
  activity: boolean;
  mentions: boolean;
  dailyAgenda: boolean;
  emailEnabled: boolean;
  pushEnabled: boolean;
  /** Local hour (0-23) the daily digest is sent, in `timezone`. */
  digestHour: number;
  /** IANA timezone name, e.g. "Asia/Kolkata". */
  timezone: string;
}

/** Everything the notification bell renders, fetched in one poll. */
export interface Bell {
  invitations: Invitation[];
  leaveRequests: LeaveRequest[];
  notifications: AppNotification[];
  orgs: OrgMembership[];
}

export interface Note extends Audience {
  id: string;
  date: string; // YYYY-MM-DD
  content: string;
  /**
   * @handles in the content naming a real teammate who can't see this note.
   * Returned on create/update so we can tell the author the mention went
   * nowhere. Empty on reads.
   */
  unreachableMentions?: string[];
  creatorName?: string | null; // who added it (shown on the calendar)
  mine?: boolean; // created by the current user
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

export interface BoardSummary extends Audience {
  id: string;
  date: string; // YYYY-MM-DD
  title: string;
  creatorName?: string | null; // who created it (shown on the calendar)
  createdAt: string;
  updatedAt: string;
  boxCount: number;
  openTaskCount: number; // tasks not yet done, across all boxes
}

export interface BoardDetail extends Audience {
  id: string;
  date: string;
  title: string;
  mine?: boolean; // created by the current user
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

export interface MeetingSummary extends Audience {
  id: string;
  name: string;
  date: string; // YYYY-MM-DD
  schedule: Schedule;
  duration: string;
  creatorName?: string | null; // who created it (shown on the calendar)
  sectionCount: number;
  sections: MeetingSection[];
  createdAt: string;
  updatedAt: string;
}

export interface MeetingDetail extends Audience {
  id: string;
  name: string;
  date: string; // YYYY-MM-DD
  schedule: Schedule;
  duration: string;
  mine?: boolean; // created by the current user
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
  // Audience. Optional on input; the backend defaults to "everyone".
  visibility?: Visibility;
  visibleDepartments?: string[];
  visibleMembers?: string[];
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
  // All orgs the user belongs to (switcher) and pending invites (bell).
  myOrgs: OrgMembership[];
  invitations: Invitation[];
  // Members asking to leave orgs the current user owns (owner's bell).
  leaveRequests: LeaveRequest[];
  // In-app messages for the current user (e.g. leave request outcome).
  notifications: AppNotification[];
  // Notification settings. Null until loaded - the Settings page fetches them on
  // mount; nothing else needs them, so they're not part of bootstrap.
  prefs: NotificationPrefs | null;
  access: Access | null;
  team: TeamMember[];
  departments: Department[];
  notes: Note[];
  boards: BoardSummary[];
  meetings: MeetingSummary[];
  templates: Template[];
  // Org-wide feed for the shared calendar: every member's boards/meetings.
  // (`boards`/`meetings` above are only the current user's, for their lists.)
  calendarBoards: BoardSummary[];
  calendarMeetings: MeetingSummary[];
  status: Status;

  // Lifecycle
  bootstrap: () => Promise<void>;
  refreshOrgData: () => Promise<void>;
  refreshBoards: () => Promise<void>;
  refreshMeetings: () => Promise<void>;
  refreshTemplates: () => Promise<void>;
  refreshCalendarFeed: () => Promise<void>;

  // Boards
  createBoard: (date: string, title?: string, audience?: Audience) => Promise<BoardDetail>;
  renameBoard: (id: string, title: string) => Promise<void>;
  setBoardAudience: (id: string, audience: Audience) => Promise<void>;
  copyBoard: (id: string, date: string, title?: string) => Promise<void>;
  deleteBoard: (id: string) => Promise<void>;

  // Meetings
  createMeeting: (input: MeetingInput) => Promise<MeetingDetail>;
  renameMeeting: (id: string, name: string) => Promise<void>;
  setMeetingAudience: (id: string, audience: Audience) => Promise<void>;
  copyMeeting: (id: string, date: string, name?: string) => Promise<void>;
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
  switchOrg: (id: string) => Promise<void>;
  leaveOrg: () => Promise<void>;

  // Invitations
  refreshInvitations: () => Promise<void>;
  acceptInvitation: (id: string) => Promise<void>;
  declineInvitation: (id: string) => Promise<void>;

  // Leave requests (owner-facing)
  refreshLeaveRequests: () => Promise<void>;
  acceptLeaveRequest: (memberId: string) => Promise<void>;
  declineLeaveRequest: (memberId: string) => Promise<void>;

  // Notification bell - light poll of invites + leave requests + messages.
  refreshBell: () => Promise<void>;
  dismissNotification: (id: string) => Promise<void>;

  // Notification settings
  refreshPrefs: () => Promise<void>;
  updatePrefs: (patch: Partial<NotificationPrefs>) => Promise<void>;

  // Team
  inviteMember: (
    name: string,
    email: string,
    role: Role,
    permissions: Permissions,
    departmentId?: string | null,
  ) => Promise<void>;
  removeMember: (id: string) => Promise<void>;
  updateMemberRole: (id: string, role: Role) => Promise<void>;
  updateMemberPermissions: (id: string, permissions: Permissions) => Promise<void>;
  updateMemberDepartment: (id: string, departmentId: string | null) => Promise<void>;

  // Departments
  createDepartment: (name: string) => Promise<void>;
  deleteDepartment: (id: string) => Promise<void>;

  // Notes
  // Returns the saved note so the caller can surface unreachableMentions.
  saveNote: (date: string, content: string, id?: string, audience?: Audience) => Promise<Note>;
  deleteNote: (id: string) => Promise<void>;

  // Profile
  updateProfile: (name: string, email: string, password?: string) => Promise<void>;
}

const errMsg = (e: unknown, fallback: string) => (e instanceof ApiError ? e.message : fallback);

export const useStore = create<AppState>((set, get) => ({
  token: null,
  currentUser: null,
  organization: null,
  myOrgs: [],
  invitations: [],
  leaveRequests: [],
  notifications: [],
  prefs: null,
  access: null,
  team: [],
  departments: [],
  notes: [],
  boards: [],
  meetings: [],
  templates: [],
  calendarBoards: [],
  calendarMeetings: [],
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
      // Token invalid/expired - clear the session.
      setToken(null);
      setActiveOrgId(null);
      set({
        token: null,
        currentUser: null,
        organization: null,
        myOrgs: [],
        invitations: [],
        leaveRequests: [],
        notifications: [],
        prefs: null,
        access: null,
        team: [],
        departments: [],
        notes: [],
        boards: [],
        meetings: [],
        templates: [],
        calendarBoards: [],
        calendarMeetings: [],
      });
    } finally {
      set({ status: "ready" });
    }
  },

  refreshOrgData: async () => {
    // 1. Which orgs do I belong to, and do I have pending invites?
    let [myOrgs, invitations] = await Promise.all([
      api.getOrganizations().catch((): OrgMembership[] => []),
      api.getInvitations().catch((): Invitation[] => []),
    ]);
    // Brand-new user with no org of their own but an invite waiting → auto-join
    // the first one (so they skip onboarding and land in a workspace).
    if (myOrgs.length === 0 && invitations.length > 0) {
      await api.acceptInvitation(invitations[0].id).catch(() => {});
      [myOrgs, invitations] = await Promise.all([
        api.getOrganizations().catch((): OrgMembership[] => []),
        api.getInvitations().catch((): Invitation[] => []),
      ]);
    }
    set({ myOrgs, invitations });

    if (myOrgs.length === 0) {
      setActiveOrgId(null);
      // A user with no org can still have notifications (e.g. just got removed).
      const notifications = await api.getNotifications().catch((): AppNotification[] => []);
      set({
        organization: null,
        access: null,
        team: [],
        departments: [],
        notes: [],
        boards: [],
        meetings: [],
        templates: [],
        calendarBoards: [],
        calendarMeetings: [],
        leaveRequests: [],
        notifications,
      });
      return;
    }

    // 2. Pin the active org to one we actually belong to.
    const current = getActiveOrgId();
    const activeId = current && myOrgs.some((o) => o.id === current) ? current : myOrgs[0].id;
    setActiveOrgId(activeId);

    // 3. Load access + data for the active org (X-Org-Id now set).
    const [
      access,
      org,
      team,
      departments,
      notes,
      boards,
      meetings,
      templates,
      calendarBoards,
      calendarMeetings,
      leaveRequests,
      notifications,
    ] = await Promise.all([
      api.getAccess().catch((): Access => ({ isOwner: true, role: "Owner", permissions: {} })),
      api.getOrganization(),
      api.getTeam(),
      api.getDepartments().catch((): Department[] => []),
      api.getNotes(),
      api.getBoards(), // my boards (list page)
      api.getMeetings(), // my meetings (list page)
      api.getTemplates().catch(() => []),
      api.getBoards("org").catch(() => []),
      api.getMeetings("org").catch(() => []),
      api.getLeaveRequests().catch((): LeaveRequest[] => []),
      api.getNotifications().catch((): AppNotification[] => []),
    ]);
    set({
      access,
      organization: org,
      team,
      departments,
      notes,
      boards,
      meetings,
      templates,
      calendarBoards,
      calendarMeetings,
      leaveRequests,
      notifications,
    });
  },

  refreshInvitations: async () => {
    set({ invitations: await api.getInvitations().catch((): Invitation[] => []) });
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

  // Reload the org-wide calendar feed (everyone's boards + meetings).
  refreshCalendarFeed: async () => {
    const [calendarBoards, calendarMeetings] = await Promise.all([
      api.getBoards("org").catch(() => []),
      api.getMeetings("org").catch(() => []),
    ]);
    set({ calendarBoards, calendarMeetings });
  },

  createBoard: async (date, title, audience) => {
    const board = await api.createBoard(date, title, audience);
    await get().refreshBoards();
    void get().refreshCalendarFeed();
    return board;
  },

  renameBoard: async (id, title) => {
    const updated = await api.renameBoard(id, title);
    set((s) => ({
      boards: s.boards.map((b) => (b.id === id ? updated : b)),
      calendarBoards: s.calendarBoards.map((b) => (b.id === id ? updated : b)),
    }));
  },

  setBoardAudience: async (id, audience) => {
    const updated = await api.setBoardAudience(id, audience);
    // The board may now be visible to more/fewer people on the shared calendar.
    set((s) => ({
      boards: s.boards.map((b) => (b.id === id ? updated : b)),
      calendarBoards: s.calendarBoards.map((b) => (b.id === id ? updated : b)),
    }));
    void get().refreshCalendarFeed();
  },

  copyBoard: async (id, date, title) => {
    await api.copyBoard(id, date, title);
    await get().refreshBoards();
    void get().refreshCalendarFeed();
  },

  deleteBoard: async (id) => {
    await api.deleteBoard(id);
    set((s) => ({
      boards: s.boards.filter((b) => b.id !== id),
      calendarBoards: s.calendarBoards.filter((b) => b.id !== id),
    }));
  },

  createMeeting: async (input) => {
    const meeting = await api.createMeeting(input);
    await get().refreshMeetings();
    void get().refreshCalendarFeed();
    return meeting;
  },

  renameMeeting: async (id, name) => {
    const updated = await api.updateMeeting(id, { name });
    const patch = (m: MeetingSummary): MeetingSummary =>
      m.id === id
        ? { ...m, name: updated.name, schedule: updated.schedule, duration: updated.duration }
        : m;
    set((s) => ({
      meetings: s.meetings.map(patch),
      calendarMeetings: s.calendarMeetings.map(patch),
    }));
  },

  setMeetingAudience: async (id, audience) => {
    const updated = await api.setMeetingAudience(id, audience);
    const patch = (m: MeetingSummary): MeetingSummary =>
      m.id === id
        ? {
            ...m,
            visibility: updated.visibility,
            visibleDepartments: updated.visibleDepartments,
            visibleMembers: updated.visibleMembers,
          }
        : m;
    set((s) => ({
      meetings: s.meetings.map(patch),
      calendarMeetings: s.calendarMeetings.map(patch),
    }));
    void get().refreshCalendarFeed();
  },

  copyMeeting: async (id, date, name) => {
    await api.copyMeeting(id, date, name);
    await get().refreshMeetings();
    void get().refreshCalendarFeed();
  },

  deleteMeeting: async (id) => {
    await api.deleteMeeting(id);
    set((s) => ({
      meetings: s.meetings.filter((m) => m.id !== id),
      calendarMeetings: s.calendarMeetings.filter((m) => m.id !== id),
    }));
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
      setActiveOrgId(null);
      set({ token, currentUser: user });
      // Resolves any pending invite (auto-join) or leaves them at onboarding.
      await get().refreshOrgData();
      set({ status: "ready" });
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
    setActiveOrgId(null);
    set({
      token: null,
      currentUser: null,
      organization: null,
      myOrgs: [],
      invitations: [],
      leaveRequests: [],
      notifications: [],
      prefs: null,
      access: null,
      team: [],
      departments: [],
      notes: [],
      boards: [],
      meetings: [],
      templates: [],
      calendarBoards: [],
      calendarMeetings: [],
      status: "ready",
    });
  },

  createOrg: async (name, description) => {
    const org = await api.createOrg(name, description);
    // A user can own several orgs; make the new one active and reload.
    setActiveOrgId(org.id);
    await get().refreshOrgData();
  },

  updateOrg: async (name, description) => {
    const org = await api.updateOrg(name, description);
    set((s) => ({
      organization: org,
      myOrgs: s.myOrgs.map((o) =>
        o.id === org.id ? { ...o, name: org.name, description: org.description } : o,
      ),
    }));
  },

  deleteOrg: async () => {
    await api.deleteOrg();
    // Drop it from the active selection and reload whatever remains.
    setActiveOrgId(null);
    await get().refreshOrgData();
  },

  switchOrg: async (id) => {
    setActiveOrgId(id);
    await get().refreshOrgData();
  },

  leaveOrg: async () => {
    // Sends a leave request to the owner; the member keeps access until approved.
    await api.leaveOrganization();
    // Optimistically flag our own membership so the "pending" state persists
    // across navigation without waiting for a reload.
    const email = get().currentUser?.email;
    set((s) => ({
      team: s.team.map((m) => (m.email === email ? { ...m, status: "LeaveRequested" } : m)),
    }));
  },

  acceptInvitation: async (id) => {
    await api.acceptInvitation(id);
    // Joining adds an org to the switcher and clears the invite.
    await get().refreshOrgData();
  },

  declineInvitation: async (id) => {
    await api.declineInvitation(id);
    set((s) => ({ invitations: s.invitations.filter((i) => i.id !== id) }));
  },

  refreshLeaveRequests: async () => {
    set({ leaveRequests: await api.getLeaveRequests().catch((): LeaveRequest[] => []) });
  },

  acceptLeaveRequest: async (memberId) => {
    // Owner approves - the member is removed from the organization.
    await api.acceptLeaveRequest(memberId);
    set((s) => ({
      leaveRequests: s.leaveRequests.filter((r) => r.id !== memberId),
      team: s.team.filter((m) => m.id !== memberId),
    }));
  },

  declineLeaveRequest: async (memberId) => {
    await api.declineLeaveRequest(memberId);
    set((s) => ({
      leaveRequests: s.leaveRequests.filter((r) => r.id !== memberId),
      team: s.team.map((m) => (m.id === memberId ? { ...m, status: "Active" } : m)),
    }));
  },

  // Light refresh of everything shown in the bell - polled on an interval so
  // invites, leave requests and messages appear without a manual reload. One
  // request, not five: the bell polls from every open tab, and each separate
  // fetch re-paid the JWT decode and active-org resolve on the backend.
  // Throws on failure so the caller can back off rather than hammer a dead API.
  refreshBell: async () => {
    const bell = await api.getBell();
    set({
      invitations: bell.invitations,
      leaveRequests: bell.leaveRequests,
      notifications: bell.notifications,
      myOrgs: bell.orgs,
    });
    // If our active org vanished (e.g. an owner approved our leave), reconcile
    // the whole session so we land on another org - or onboarding if we have none.
    const activeId = getActiveOrgId();
    if (activeId && !bell.orgs.some((o) => o.id === activeId)) {
      await get().refreshOrgData();
    }
  },

  dismissNotification: async (id) => {
    set((s) => ({ notifications: s.notifications.filter((n) => n.id !== id) }));
    await api.dismissNotification(id).catch(() => {});
  },

  refreshPrefs: async () => {
    set({ prefs: await api.getNotificationPrefs() });
  },

  updatePrefs: async (patch) => {
    // Optimistic: a settings switch that lags behind the pointer feels broken.
    // Snapshot first so a failed save snaps back rather than lying about state.
    const previous = get().prefs;
    if (previous) set({ prefs: { ...previous, ...patch } });
    try {
      set({ prefs: await api.updateNotificationPrefs(patch) });
    } catch (err) {
      set({ prefs: previous });
      throw err;
    }
  },

  inviteMember: async (name, email, role, permissions, departmentId) => {
    const member = await api.inviteMember(name, email, role, permissions, departmentId);
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

  updateMemberDepartment: async (id, departmentId) => {
    const member = await api.updateMember(id, { departmentId });
    set((s) => ({ team: s.team.map((m) => (m.id === id ? member : m)) }));
  },

  createDepartment: async (name) => {
    const dept = await api.createDepartment(name);
    set((s) => ({ departments: [...s.departments, dept] }));
  },

  deleteDepartment: async (id) => {
    await api.deleteDepartment(id);
    // The department is gone and its members are unassigned server-side; reflect
    // both locally without a full reload.
    set((s) => ({
      departments: s.departments.filter((d) => d.id !== id),
      team: s.team.map((m) => (m.departmentId === id ? { ...m, departmentId: null } : m)),
    }));
  },

  saveNote: async (date, content, id, audience) => {
    if (id) {
      const note = await api.updateNote(id, content, audience);
      set((s) => ({ notes: s.notes.map((n) => (n.id === id ? note : n)) }));
      return note;
    }
    const note = await api.createNote(date, content, audience);
    set((s) => ({ notes: [...s.notes, note] }));
    return note;
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
/**
 * A warning for the author when their @mention couldn't reach someone, or null.
 * Kept as a pure string builder (the store has no UI imports) - callers toast it.
 * A mention that silently does nothing is worse than no mention at all.
 */
export const unreachableMentionWarning = (note: Note): string | null => {
  const handles = note.unreachableMentions ?? [];
  if (handles.length === 0) return null;
  const who = handles.map((h) => `@${h}`).join(", ");
  return `${who} can't see this note, so they weren't notified`;
};

export const levelFor = (access: Access | null, pageKey: string): "none" | PageAccess => {
  if (!access || access.isOwner) return "edit";
  // Mandatory pages every member always has: Settings (their own profile) is
  // editable; Organization is viewable (so they can see it and leave).
  if (pageKey === "settings") return "edit";
  if (pageKey === "organization") return "view";
  return access.permissions[pageKey] ?? "none";
};

/** Hook: the current user's access level for a page ("none" | "view" | "edit"). */
export const usePageAccess = (pageKey: string): "none" | PageAccess =>
  useStore((s) => levelFor(s.access, pageKey));
