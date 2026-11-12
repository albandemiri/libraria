import React, { createContext, useContext, useEffect, useState } from 'react';
import { apiFetch, clearStoredToken, getStoredToken, setStoredToken } from '../config/api';
import { User } from '../types';

interface AuthContextType {
  user: User | null;
  token: string | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, displayName?: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  const initAuth = async () => {
    try {
      const storedToken = await getStoredToken();
      if (storedToken) {
        setToken(storedToken);
        const { user: profile } = await apiFetch<{ user: User }>('/auth/me');
        setUser(profile);
      }
    } catch {
      await clearStoredToken();
      setToken(null);
      setUser(null);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    initAuth();
  }, []);

  const login = async (email: string, password: string) => {
    const data = await apiFetch<{ user: User; token: string }>('/auth/login', {
      method: 'POST',
      authenticated: false,
      body: JSON.stringify({ email, password }),
    });

    await setStoredToken(data.token);
    setToken(data.token);
    setUser(data.user);
  };

  const register = async (email: string, password: string, displayName?: string) => {
    const data = await apiFetch<{ user: User; token: string }>('/auth/register', {
      method: 'POST',
      authenticated: false,
      body: JSON.stringify({ email, password, displayName: displayName || undefined }),
    });

    await setStoredToken(data.token);
    setToken(data.token);
    setUser(data.user);
  };

  const logout = async () => {
    await clearStoredToken();
    setToken(null);
    setUser(null);
  };

  const refreshProfile = async () => {
    if (!token) return;
    try {
      const { user: profile } = await apiFetch<{ user: User }>('/auth/me');
      setUser(profile);
    } catch {
      await logout();
    }
  };

  return (
    <AuthContext.Provider
      value={{ user, token, isLoading, login, register, logout, refreshProfile }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = (): AuthContextType => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

