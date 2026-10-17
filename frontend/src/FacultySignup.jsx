import {API_BASE} from './api-config';
import CollegeSelect from './CollegeSelect';
import { useState } from "react";

export default function FacultySignup({ onBack }) {
  const [form, setForm] = useState({
    collegeCode: "",
    facultyId: "",
    fullName: "",
    email: "",
    department: "",
    designation: "",
    password: "",
    confirmPassword: "",
  });

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  function updateField(event) {
    const { name, value } = event.target;
    setForm((previous) => ({ ...previous, [name]: value }));
    setError("");
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");

    if (form.password !== form.confirmPassword) {
      setError("The passwords do not match.");
      return;
    }

    if (
      form.password.length < 12 ||
      new TextEncoder().encode(form.password).length > 72
    ) {
      setError(
        "Use at least 12 characters and no more than 72 UTF-8 bytes for your password."
      );
      return;
    }

    setBusy(true);

    try {
      const response = await fetch(
        `${API_BASE}/faculty-requests`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            collegeCode: form.collegeCode,
            facultyId: form.facultyId.trim(),
            fullName: form.fullName.trim(),
            email: form.email.trim(),
            department: form.department.trim(),
            designation: form.designation.trim(),
            password: form.password,
          }),
        }
      );

      const data = await response.json();

      if (!response.ok) {
        setError(data.message || "Could not submit your request.");
        return;
      }

      setSuccess(data.message);
      setForm((previous) => ({
        ...previous,
        password: "",
        confirmPassword: "",
      }));
    } catch {
      setError(
        "Could not reach the backend. Check your connection and try again."
      );
    } finally {
      setBusy(false);
    }
  }

  if (success) {
    return (
      <main className="auth-page">
        <section className="auth-card">
          <div className="auth-logo" aria-hidden="true">CC</div>
          <h1>Request submitted</h1>

          <p className="faculty-success" role="status">
            {success}
          </p>

          <p className="auth-help">
            Your faculty ID is <strong>{form.facultyId.trim()}</strong>.
            You can check your approval status by attempting to sign in
            with your college, faculty ID, and password.
          </p>

          <button
            className="auth-button submit"
            onClick={onBack}
            style={{ marginTop: 20 }}
          >
            Back to Sign In
          </button>
        </section>
      </main>
    );
  }

  return (
    <main className="auth-page">
      <section className="auth-card faculty-signup-card">
        <div className="auth-logo" aria-hidden="true">CC</div>
        <p className="auth-brand">CampusConnect</p>
        <h1>Request faculty access</h1>
        <p className="auth-subtitle">
          Your college administrator will review your details.
          All fields are required.
        </p>

        <form onSubmit={handleSubmit}>
          <fieldset className="signup-fieldset" disabled={busy}>
            <CollegeSelect value={form.collegeCode} disabled={busy} onChange={value=>setForm(current=>({...current,collegeCode:value}))}/>

            <div className="signup-grid">
              <label className="auth-field">
                <span>Faculty ID</span>
                <input
                  name="facultyId"
                  value={form.facultyId}
                  onChange={updateField}
                  placeholder="Your official faculty ID"
                  maxLength={50}
                  autoComplete="username"
                  spellCheck={false}
                  required
                />
              </label>

              <label className="auth-field">
                <span>Full name</span>
                <input
                  name="fullName"
                  value={form.fullName}
                  onChange={updateField}
                  placeholder="Your full name"
                  maxLength={120}
                  autoComplete="name"
                  required
                />
              </label>

              <label className="auth-field">
                <span>Email address</span>
                <input
                  type="email"
                  name="email"
                  value={form.email}
                  onChange={updateField}
                  placeholder="Your college email, if available"
                  maxLength={254}
                  autoComplete="email"
                  required
                />
              </label>

              <label className="auth-field">
                <span>Department</span>
                <input
                  name="department"
                  value={form.department}
                  onChange={updateField}
                  placeholder="For example: CSE"
                  maxLength={100}
                  required
                />
              </label>
            </div>

            <label className="auth-field">
              <span>Requested designation</span>
              <input
                name="designation"
                value={form.designation}
                onChange={updateField}
                placeholder="For example: Assistant Professor"
                maxLength={100}
                required
              />
            </label>

            <div className="signup-grid">
              <label className="auth-field">
                <span>Password</span>
                <input
                  type="password"
                  name="password"
                  value={form.password}
                  onChange={updateField}
                  placeholder="At least 12 characters"
                  minLength={12}
                  autoComplete="new-password"
                  required
                />
              </label>

              <label className="auth-field">
                <span>Confirm password</span>
                <input
                  type="password"
                  name="confirmPassword"
                  value={form.confirmPassword}
                  onChange={updateField}
                  placeholder="Enter the password again"
                  minLength={12}
                  autoComplete="new-password"
                  required
                />
              </label>
            </div>

            {error && (
              <p className="auth-error" role="alert">
                {error}
              </p>
            )}

            <button className="auth-button submit" type="submit">
              {busy ? "Submitting…" : "Submit Access Request"}
            </button>
          </fieldset>
        </form>

        <p className="auth-help">
          Requesting a designation does not grant administrative,
          fee-management, or student-account-management permissions.
        </p>

        <button
          className="auth-link"
          onClick={onBack}
          disabled={busy}
        >
          Already requested access? Back to Sign In
        </button>
      </section>
    </main>
  );
}