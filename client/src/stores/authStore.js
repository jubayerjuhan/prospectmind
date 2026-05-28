import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export const useAuthStore = create(
  persist(
    (set, get) => ({
      user: null,
      organization: null,
      accessToken: null,
      refreshToken: null,
      isAuthenticated: false,

      setAuth: (user, accessToken, refreshToken) =>
        set({
          user,
          organization: user?.organization,
          accessToken,
          refreshToken,
          isAuthenticated: true,
        }),

      setTokens: (accessToken, refreshToken) => set({ accessToken, refreshToken }),

      updateUser: (user) => set({ user, organization: user?.organization }),

      logout: () =>
        set({ user: null, organization: null, accessToken: null, refreshToken: null, isAuthenticated: false }),
    }),
    {
      name: 'prospectmind-auth',
      partialize: (state) => ({
        user: state.user,
        organization: state.organization,
        accessToken: state.accessToken,
        refreshToken: state.refreshToken,
        isAuthenticated: state.isAuthenticated,
      }),
    }
  )
);
