import { useState } from "react";
import { useLocation } from "wouter";
import { Waves, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "../lib/trpc.js";
import { Button, Input, Card } from "../components/ui.js";

export function Login() {
  const [, navigate] = useLocation();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const utils = trpc.useUtils();

  const onDone = async () => {
    await utils.auth.me.invalidate();
    navigate("/");
  };

  const login = trpc.auth.login.useMutation({
    onSuccess: onDone,
    onError: (e) => toast.error(e.message),
  });
  const register = trpc.auth.register.useMutation({
    onSuccess: onDone,
    onError: (e) => toast.error(e.message),
  });

  const pending = login.isPending || register.isPending;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 8) {
      toast.error("Password must be at least 8 characters.");
      return;
    }
    (mode === "login" ? login : register).mutate({ email, password });
  }

  return (
    <div className="flex h-full items-center justify-center p-4">
      <Card className="w-full max-w-sm p-6">
        <div className="mb-5 flex flex-col items-center gap-2 text-center">
          <Waves size={28} className="text-brand" />
          <h1 className="text-xl font-semibold">
            {mode === "login" ? "Welcome back" : "Create your account"}
          </h1>
          <p className="text-sm text-ripple-muted">
            {mode === "login"
              ? "Sign in to save locations and routes."
              : "Join to save locations, routes and preferences."}
          </p>
        </div>

        <form onSubmit={submit} className="flex flex-col gap-3">
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-ripple-muted">
              Email
            </label>
            <Input
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-ripple-muted">
              Password
            </label>
            <Input
              type="password"
              autoComplete={
                mode === "login" ? "current-password" : "new-password"
              }
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="At least 8 characters"
            />
          </div>
          <Button type="submit" variant="accent" disabled={pending}>
            {pending && <Loader2 size={16} className="animate-spin" />}
            {mode === "login" ? "Sign in" : "Create account"}
          </Button>
        </form>

        <p className="mt-4 text-center text-sm text-ripple-muted">
          {mode === "login" ? "New to Ripple?" : "Already have an account?"}{" "}
          <button
            className="font-semibold text-brand hover:underline"
            onClick={() => setMode(mode === "login" ? "register" : "login")}
          >
            {mode === "login" ? "Create an account" : "Sign in"}
          </button>
        </p>

        {mode === "login" && (
          <p className="mt-3 rounded-md bg-ripple-muted/10 p-2 text-center text-xs text-ripple-muted">
            Demo: <strong>dev@ripple.transit</strong> / <strong>password123</strong>
          </p>
        )}
      </Card>
    </div>
  );
}
