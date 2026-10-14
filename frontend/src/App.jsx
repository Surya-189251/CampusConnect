import CollegeSelect from './CollegeSelect';
import StudentProfile from "./StudentProfile";
import FacultyDashboard from "./FacultyDashboard";
import ChangePassword from "./ChangePassword";
import FacultySignup from "./FacultySignup";
import { useEffect, useState } from "react";
import Dashboard from "./Dashboard";
import "./Auth.css";

const SESSION_KEY = "campusconnect.session";
function readSavedToken() {
  try { return sessionStorage.getItem(SESSION_KEY); } catch { return null; }
}
function saveToken(token) {
  try { sessionStorage.setItem(SESSION_KEY, token); return true; } catch { return false; }
}
function clearSavedToken() {
  try { sessionStorage.removeItem(SESSION_KEY); } catch { /* Storage may be disabled. */ }
}

const API_URL = "http://localhost:5000/api";

export default function App() {
  const [changingPassword,setChangingPassword]=useState(false);
  const [role, setRole] = useState("student");
  const [collegeCode, setCollegeCode] = useState("");
  const [showFacultySignup, setShowFacultySignup] = useState(false);
  const [loginId, setLoginId] = useState("");
  const [password, setPassword] = useState("");
  const [session, setSession] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const [restoring, setRestoring] = useState(true);
  const [restoreError, setRestoreError] = useState("");
  const [restoreAttempt, setRestoreAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    let active = true;
    async function restore() {
      const token = readSavedToken();
      if (!token) { clearTimeout(timeout); if (active) setRestoring(false); return; }
      try {
        const response = await fetch(`${API_URL}/auth/me`, {
          headers: { Authorization: `Bearer ${token}` }, signal: controller.signal,
        });
        if (!active) return;
        if (response.status === 401 || response.status === 403) {
          clearSavedToken();
          setError("Your session has ended. Please sign in again.");
          return;
        }
        if (!response.ok) throw new Error("Session check failed");
        const data = await response.json();
        if (!data.user) throw new Error("Missing account details");
        if (active) setSession({ token, user: data.user });
      } catch {
        if (active) setRestoreError("Could not reconnect to the backend. Start the backend, then click Try again.");
      } finally {
        clearTimeout(timeout);
        if (active) setRestoring(false);
      }
    }
    restore();
    return () => { active = false; clearTimeout(timeout); controller.abort(); };
  }, [restoreAttempt]);

  async function handleLogin(event) {
    event.preventDefault();
    setBusy(true);
    setError("");

    try {
      const response = await fetch(`${API_URL}/auth/login`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          loginId: loginId.trim(),
          password,
          role,
          collegeCode,
      }),
      });

      const data = await response.json();

      if (!response.ok) {
        setError(data.message || "Login failed. Please try again.");
        return;
      }

      // Confirm that the issued session can access a protected endpoint.
      const profileResponse = await fetch(`${API_URL}/auth/me`, {
        headers: {
          Authorization: `Bearer ${data.token}`,
        },
      });

      const profileData = await profileResponse.json();

      if (!profileResponse.ok) {
        setError(profileData.message || "Could not verify your session.");
        return;
      }

      if (!saveToken(data.token)) {
        setError("You are signed in, but this browser has blocked session storage. Refreshing will require signing in again.");
      }
      setSession({
        token: data.token,
        user: profileData.user,
      });

      setPassword("");
      setLoginId("");
    } catch {
      setError(
        "Could not complete login. Check that the backend is running on port 5000."
      );
    } finally {
      setBusy(false);
    }
  }

  async function handleLogout() {
    setBusy(true);
    setError("");

    try {
      const response = await fetch(`${API_URL}/auth/logout`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.token}`,
        },
      });

      // A 401 means the session is already expired or unavailable.
      if (!response.ok && response.status !== 401) {
        setError("Logout failed. Please try again.");
        return;
      }

      clearSavedToken();
      setSession(null);
      setPassword("");
    } catch {
      setError("Could not reach the backend. Please retry logout.");
    } finally {
      setBusy(false);
    }
  }
  if (restoring || restoreError) {
    return <main className="auth-page"><section className="auth-card">
      <h1>{restoring ? "Restoring your session…" : "Connection unavailable"}</h1>
      {restoring ? <p role="status">Checking your account with CampusConnect.</p> : <>
        <p className="auth-error" role="alert">{restoreError}</p>
        <button className="auth-button submit" onClick={() => {
          setRestoreError(""); setRestoring(true); setRestoreAttempt(value => value + 1);
        }}>Try again</button>
      </>}
    </section></main>;
  }
  if (showFacultySignup && !session) {
  return (
    <FacultySignup
      onBack={() => {
        setShowFacultySignup(false);
        setRole("faculty");
        setPassword("");
        setError("");
      }}
    />
  );
}
  if (session) {
    return (
      <>
        <div
          className={`session-banner ${
            (session.user.role !== "admin" || session.user.mustChangePassword || changingPassword) ? "session-banner-full" : ""
      }`}
    >
          <div>
            <strong>{session.user.fullName}</strong>
            <span>
              {session.user.loginId} · {session.user.role} · {session.user.collegeName}
            </span>
          </div>

          <div className="session-actions">{!session.user.mustChangePassword&&<button className="auth-button secondary" onClick={()=>setChangingPassword(true)}>Change password</button>}<button
            className="auth-button secondary"
            onClick={() => { setChangingPassword(false); handleLogout(); }}
            disabled={busy}
          >
            {busy ? "Please wait…" : "Log out"}
          </button></div>
        </div>

        {error && (
          <p className="session-error" role="alert">
            {error}
          </p>
        )}

        {session.user.mustChangePassword || changingPassword ? (
          <ChangePassword token={session.token} requiredChange={session.user.mustChangePassword} onCancel={() => setChangingPassword(false)} onComplete={() => { setChangingPassword(false); clearSavedToken(); setSession(null); setPassword(''); setError('Password updated. Sign in with your new password.'); }} />
        ) : session.user.role === "student" ? (
          <StudentProfile token={session.token} />
        ) : session.user.role === "faculty" ? (
          <FacultyDashboard token={session.token} user={session.user} />
        ) : session.user.role === "admin" ? (
          <Dashboard token={session.token} />
        ) : (
          <main className="account-placeholder">
            <h1>Welcome, {session.user.fullName}</h1>
            <p>
              {session.user.role === "student"
                ? "Your personal academic records and fee-payment screen will be added next."
                : "Your academic tools and assigned classes will be added next."}
            </p>
            <p>Your account is approved and you are signed in.</p>
          </main>
        )}
      </>
    );
  }

  const idLabel =
    role === "student"
      ? "Roll number"
      : role === "faculty"
        ? "Faculty ID"
        : "Administrator ID";

  return (
    <main className="auth-page">
      <section className="auth-card" aria-labelledby="login-heading">
        <div className="auth-logo" aria-hidden="true">
          CC
        </div>

        <p className="auth-brand">CampusConnect</p>
        <h1 id="login-heading">Welcome back</h1>
        <p className="auth-subtitle">
          Sign in to access your college portal.
        </p>

        <form onSubmit={handleLogin}>
  <CollegeSelect value={collegeCode} disabled={busy} onChange={value=>{setCollegeCode(value);setError('');setLoginId('');setPassword('');}}/>
          <fieldset className="role-selector" disabled={busy}>
            <legend>Choose your account type</legend>

            <div className="role-options">
              {["student", "faculty", "admin"].map((accountRole) => (
                <label
                  key={accountRole}
                  className={role === accountRole ? "selected" : ""}
                >
                  <input
                    type="radio"
                    name="accountRole"
                    value={accountRole}
                    checked={role === accountRole}
                    onChange={() => {
                      setRole(accountRole);
                      setError("");
                      setLoginId("");
                      setPassword("");
                    }}
                  />
                  {accountRole === "admin"
                    ? "Admin"
                    : accountRole === "faculty"
                      ? "Faculty"
                      : "Student"}
                </label>
              ))}
            </div>
          </fieldset>

          <label className="auth-field">
            <span>{idLabel}</span>
            <input
              type="text"
              value={loginId}
              onChange={(event) => setLoginId(event.target.value)}
              placeholder={`Enter your ${idLabel.toLowerCase()}`}
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              maxLength={50}
              disabled={busy}
              required
            />
          </label>

          <label className="auth-field">
            <span>Password</span>
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Enter your password"
              autoComplete="current-password"
              disabled={busy}
              required
            />
          </label>

          {error && (
            <p className="auth-error" role="alert">
              {error}
            </p>
          )}

          <button
            className="auth-button submit"
            type="submit"
            disabled={busy}
          >
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </form>
          {role === "faculty" && (
            <button
              type="button"
              className="auth-link"
              disabled={busy}
              onClick={() => {
                setError("");
                setPassword("");
                setShowFacultySignup(true);
          }}
        >
          New faculty member? Request access
        </button>
      )}

        <p className="auth-help">
          {role === "faculty"
            ? "Faculty access requires administrator approval. New faculty members can request access using the link above."
            : role === "student"
              ? "Use the student account provided by your college administrator."
              : "Administrator access is restricted to approved accounts."}
        </p>
      </section>
    </main>
  );
}