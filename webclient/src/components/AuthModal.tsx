import { useState } from "react";
import { useNavigate, useLocation, Link } from "react-router-dom";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "./ui/dialog.js";
import { useAuth } from "../context/auth-provider.js";
import { Input } from "./ui/input.js";
import { Button } from "./ui/button.js";
import { postApiAuthLogin, postApiAuthRegister } from "@/api/generated/sentimentSearchAPI.gen.js";

export function AuthModal({ isRegister = false }: { isRegister?: boolean }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { login } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  const handleOpenChange = (open: boolean) => {
    if (!open) {
      // Go back to the background location if it exists
      navigate(-1);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    try {
      if (isRegister) {
        const res = await postApiAuthRegister({ username, password });
        if (res.status === 200 && res.data && 'token' in res.data) {
          login((res.data as unknown as { token: string }).token);
        } else {
          throw new Error("Registration failed");
        }
      } else {
        const res = await postApiAuthLogin({ username, password });
        if (res.status === 200 && res.data && 'token' in res.data) {
          login((res.data as unknown as { token: string }).token);
        } else {
          throw new Error("Login failed");
        }
      }
      // After successful login/register, navigate to the background location
      const state = location.state as { backgroundLocation?: Location };
      navigate(state?.backgroundLocation?.pathname || "/", { replace: true });
    } catch (err: unknown) {
      if (typeof err === "object" && err !== null && "response" in err) {
        setError((err as { response?: { data?: { error?: string } } }).response?.data?.error || "An error occurred");
      } else {
        setError("An error occurred");
      }
    }
  };

  return (
    <Dialog open={true} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>{isRegister ? "Create an account" : "Sign In"}</DialogTitle>
          <DialogDescription>
            {isRegister ? "Join to manage your watchlist and portfolio." : "Welcome back! Sign in to continue."}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 py-4">
          <div className="space-y-2">
            <Input
              placeholder="Username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
            />
          </div>
          <div className="space-y-2">
            <Input
              type="password"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>
          {error && <p className="text-sm text-red-500">{error}</p>}
          <Button type="submit" className="w-full">
            {isRegister ? "Register" : "Sign In"}
          </Button>
        </form>
        <div className="text-center text-sm">
          {isRegister ? (
            <p>Already have an account? <Link to="/login" state={location.state} className="underline underline-offset-4">Sign in</Link></p>
          ) : (
            <p>Don&apos;t have an account? <Link to="/register" state={location.state} className="underline underline-offset-4">Register</Link></p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
