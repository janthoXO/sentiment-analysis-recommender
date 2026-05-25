import { createContext, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { useNavigate, useLocation } from "react-router-dom";

interface AuthContextType {
  token: string | null;
  isAuthenticated: boolean;
  login: (token: string) => void;
  logout: () => void;
  requireAuth: <T extends (...args: unknown[]) => unknown>(fn: T) => (...args: Parameters<T>) => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(localStorage.getItem("token"));
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    if (token) {
      localStorage.setItem("token", token);
    } else {
      localStorage.removeItem("token");
    }
  }, [token]);

  const login = (newToken: string) => {
    setToken(newToken);
  };

  const logout = () => {
    setToken(null);
  };

  const requireAuth = <T extends (...args: unknown[]) => unknown>(fn: T) => {
    return (...args: Parameters<T>) => {
      if (!token) {
        navigate("/login", { state: { backgroundLocation: location } });
      } else {
        fn(...args);
      }
    };
  };

  return (
    <AuthContext.Provider value={{ token, isAuthenticated: !!token, login, logout, requireAuth }}>
      {children}
    </AuthContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
};
