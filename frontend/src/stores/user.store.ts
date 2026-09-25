import { create } from 'zustand';

export type UserRole = 'SUPER_ADMIN' | 'ADMIN' | 'MANAGER' | 'CASHIER' | 'INVENTORY_CLERK';
export type UserStatus = 'ACTIVE' | 'INACTIVE' | 'SUSPENDED';

export interface UserRecord {
  id: string;
  firstName: string;
  lastName: string;
  username: string;
  email: string;
  phone: string;
  role: UserRole;
  status: UserStatus;
  branch: string;
  lastLogin?: string;
  isActive: boolean;
  createdAt: string;
  /** Hashed-equivalent local password. Stored as plain text for local-only mode.
   *  In production this would be handled by the Django backend.  */
  password?: string;
}

interface UserStore {
  users: UserRecord[];
  addUser: (data: Omit<UserRecord, 'id' | 'createdAt' | 'lastLogin'>) => UserRecord;
  updateUser: (id: string, data: Partial<UserRecord>) => void;
  setPassword: (id: string, newPassword: string) => void;
  deactivateUser: (id: string) => void;
  activateUser: (id: string) => void;
  deleteUser: (id: string) => void;
}

const STORAGE_KEY = 'popmyc-users';

function genId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `usr-${Date.now()}-${Math.floor(Math.random() * 1000000)}`;
}

// No seed users — fresh installations start with an empty user list.
// Real users are loaded from the backend API by the UsersPage component.
// DO NOT add developer/test users here — they would appear on every new installation.
const seedUsers: UserRecord[] = [];

interface StoredState {
  users: UserRecord[];
}

function loadState(): StoredState {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored) as StoredState;
      if (parsed?.users) {
        return parsed;
      }
    }
  } catch { /* noop */ }
  const initial = { users: seedUsers };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(initial));
  return initial;
}

function persist(state: StoredState) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export const useUserStore = create<UserStore>((set) => {
  const initial = loadState();
  return {
    users: initial.users,

    addUser: (data) => {
      const newUser: UserRecord = {
        ...data,
        id: genId(),
        lastLogin: undefined,
        createdAt: new Date().toISOString(),
      };
      set((state) => {
        const next = [newUser, ...state.users];
        persist({ users: next });
        return { users: next };
      });
      return newUser;
    },

    updateUser: (id, data) => {
      set((state) => {
        const next = state.users.map((u) => u.id === id ? { ...u, ...data } : u);
        persist({ users: next });
        return { users: next };
      });
    },

    setPassword: (id, newPassword) => {
      set((state) => {
        const next = state.users.map((u) =>
          u.id === id ? { ...u, password: newPassword } : u
        );
        persist({ users: next });
        return { users: next };
      });
    },

    deactivateUser: (id) => {
      set((state) => {
        const next = state.users.map((u) =>
          u.id === id ? { ...u, status: 'INACTIVE' as UserStatus, isActive: false } : u
        );
        persist({ users: next });
        return { users: next };
      });
    },

    activateUser: (id) => {
      set((state) => {
        const next = state.users.map((u) =>
          u.id === id ? { ...u, status: 'ACTIVE' as UserStatus, isActive: true } : u
        );
        persist({ users: next });
        return { users: next };
      });
    },

    deleteUser: (id) => {
      set((state) => {
        const next = state.users.filter((u) => u.id !== id);
        persist({ users: next });
        return { users: next };
      });
    },
  };
});
