import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

// Automatically resolve localhost for Android Emulator (10.0.2.2) vs iOS/Web (localhost)
export const API_BASE_URL =
  Platform.OS === 'android' ? 'http://10.0.2.2:3000' : 'http://localhost:3000';

const TOKEN_KEY = 'libraria_access_token';

export async function getStoredToken(): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(TOKEN_KEY);
  } catch {
    return null;
  }
}

export async function setStoredToken(token: string): Promise<void> {
  try {
    await SecureStore.setItemAsync(TOKEN_KEY, token);
  } catch (err) {
    console.error('Failed to store auth token:', err);
  }
}

export async function clearStoredToken(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(TOKEN_KEY);
  } catch (err) {
    console.error('Failed to clear auth token:', err);
  }
}

interface ApiRequestOptions extends RequestInit {
  authenticated?: boolean;
}

export async function apiFetch<T>(
  endpoint: string,
  options: ApiRequestOptions = {},
): Promise<T> {
  const { authenticated = true, headers = {}, ...rest } = options;

  const requestHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(headers as Record<string, string>),
  };

  if (authenticated) {
    const token = await getStoredToken();
    if (token) {
      requestHeaders['Authorization'] = `Bearer ${token}`;
    }
  }

  const url = `${API_BASE_URL}${endpoint.startsWith('/') ? endpoint : `/${endpoint}`}`;
  const response = await fetch(url, {
    headers: requestHeaders,
    ...rest,
  });

  if (!response.ok) {
    let errorData: { error?: { message?: string; code?: string } } | null = null;
    try {
      errorData = await response.json();
    } catch {
      // response wasn't json
    }

    const message =
      errorData?.error?.message || `Request failed with status ${response.status}`;
    const error = new Error(message);
    (error as Error & { status?: number; code?: string }).status = response.status;
    (error as Error & { status?: number; code?: string }).code = errorData?.error?.code;
    throw error;
  }

  if (response.status === 204) {
    return null as unknown as T;
  }

  return response.json();
}

