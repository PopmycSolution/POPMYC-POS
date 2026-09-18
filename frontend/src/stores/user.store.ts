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

function daysAgo(d: number): string {
  const dt = new Date();
  dt.setDate(dt.getDate() - d);
  return dt.toISOString();
}

const seedUsers: UserRecord[] = [
  { id: 'usr1', firstName: 'Owusu',  lastName: 'Michael',    username: 'owusu.michael',  email: 'ranchomyc2019@gmail.com', phone: '0244000001', role: 'SUPER_ADMIN',     status: 'ACTIVE',    branch: 'Main Branch',    isActive: true,  lastLogin: daysAgo(0),  createdAt: daysAgo(400), password: 'Omyc@65171765@' },
  { id: 'usr2', firstName: 'Grace',  lastName: 'Appiah',     username: 'grace.appiah',   email: 'grace@popmyc.com',        phone: '0201222333', role: 'ADMIN',           status: 'ACTIVE',    branch: 'Main Branch',    isActive: true,  lastLogin: daysAgo(0),  createdAt: daysAgo(300), password: 'Admin@1234'     },
  { id: 'usr3', firstName: 'Kwame',  lastName: 'Asante',     username: 'kwame.cashier',  email: 'kwame@popmyc.com',        phone: '0551333444', role: 'CASHIER',         status: 'ACTIVE',    branch: 'Main Branch',    isActive: true,  lastLogin: daysAgo(1),  createdAt: daysAgo(180), password: 'Cashier@1234'   },
  { id: 'usr4', firstName: 'Abena',  lastName: 'Frimpong',   username: 'abena.cashier',  email: 'abena@popmyc.com',        phone: '0277444555', role: 'CASHIER',         status: 'ACTIVE',    branch: 'Main Branch',    isActive: true,  lastLogin: daysAgo(0),  createdAt: daysAgo(120), password: 'Cashier@1234'   },
  { id: 'usr5', firstName: 'Kofi',   lastName: 'Mensah',     username: 'kofi.inventory', email: 'kofi@popmyc.com',         phone: '0266555666', role: 'INVENTORY_CLERK', status: 'ACTIVE',    branch: 'Main Branch',    isActive: true,  lastLogin: daysAgo(2),  createdAt: daysAgo(90),  password: 'Inventory@1234' },
  { id: 'usr6', firstName: 'Ama',    lastName: 'Darko',      username: 'ama.manager',    email: 'ama@popmyc.com',          phone: '0244666777', role: 'MANAGER',         status: 'ACTIVE',    branch: 'Kumasi Branch',  isActive: true,  lastLogin: daysAgo(3),  createdAt: daysAgo(200), password: 'Manager@1234'   },
  { id: 'usr7', firstName: 'Yaw',    lastName: 'Boateng',    username: 'yaw.cashier',    email: 'yaw@popmyc.com',          phone: '0507777888', role: 'CASHIER',         status: 'INACTIVE',  branch: 'Kumasi Branch',  isActive: false, lastLogin: daysAgo(45), createdAt: daysAgo(150), password: 'Cashier@1234'   },
  { id: 'usr8', firstName: 'Efua',   lastName: 'Sutherland', username: 'efua.cashier',   email: 'efua@popmyc.com',         phone: '0209888999', role: 'CASHIER',         status: 'SUSPENDED', branch: 'Main Branch',    isActive: false, lastLogin: daysAgo(30), createdAt: daysAgo(100), password: 'Cashier@1234'   },
];

interface StoredState {
  users: UserRecord[];
}

function loadState(): StoredState {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored) as StoredState;
      if (parsed?.users?.length > 0) {
        // Backfill passwords for seed users that were stored before passwords were added
        const needsSave = parsed.users.some((u) => {
          const seed = seedUsers.find((s) => s.id === u.id);
          return seed?.password && !u.password;
        });
        if (needsSave) {
          const backfilled = parsed.users.map((u) => {
            if (u.password) return u;
            const seed = seedUsers.find((s) => s.id === u.id);
            return seed?.password ? { ...u, password: seed.password } : u;
          });
          const next = { users: backfilled };
          localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
          return next;
        }
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
