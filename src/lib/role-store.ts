import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Role } from "@/lib/plant";

type RoleState = {
  role: Role;
  setRole: (role: Role) => void;
};

export const useRole = create<RoleState>()(
  persist(
    (set) => ({
      role: "shopfloor",
      setRole: (role) => set({ role }),
    }),
    { name: "plant-desk-role", skipHydration: true },
  ),
);
