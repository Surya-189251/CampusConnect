import {API_BASE} from './api-config';
import { useEffect, useState } from "react";

const API_URL = `${API_BASE}/admin/faculty-permissions`;

export default function FacultyPermissions({ token }) {
  const [faculty, setFaculty] = useState([]);
  const [options, setOptions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    const controller = new AbortController();

    async function loadFaculty() {
      try {
        const response = await fetch(API_URL, {
          headers: {
            Authorization: `Bearer ${token}`,
          },
          signal: controller.signal,
        });

        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.message || "Could not load faculty.");
        }

        if (!controller.signal.aborted) {
          setFaculty(data.faculty);
          setOptions(data.permissionOptions);
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          setFaculty([]);
          setError(error.message || "Could not reach the backend.");
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }

    loadFaculty();

    return () => controller.abort();
  }, [token, refreshKey]);

  function refresh() {
    setLoading(true);
    setError("");
    setMessage("");
    setRefreshKey((previous) => previous + 1);
  }

  async function changePermission(member, option, enabled) {
    setSaving(true);
    setError("");
    setMessage("");

    try {
      const response = await fetch(`${API_URL}/${member.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          permissionCode: option.code,
          enabled,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        setError(data.message || "Could not save the permission.");
        return;
      }

      setFaculty((previous) =>
        previous.map((item) =>
          item.id === member.id
            ? { ...item, permissions: data.permissions }
            : item
        )
      );

      setMessage(
        `${option.label} ${enabled ? "granted to" : "removed from"} ${member.full_name}.`
      );
    } catch {
      setError(
        "Connection interrupted. Click Refresh to check the saved permissions before trying again."
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="panel">
      <div className="section-heading">
        <div>
          <h2>Faculty Permissions</h2>
          <p className="section-description">
            Assign additional permissions to approved faculty in your college.
            Each checkbox saves immediately.
          </p>
        </div>

        <button
          className="button"
          onClick={refresh}
          disabled={loading || saving}
        >
          Refresh
        </button>
      </div>

      {error && <p className="auth-error" role="alert">{error}</p>}

      {message && (
        <p className="faculty-success" role="status">{message}</p>
      )}

      {saving && <p role="status">Saving permission…</p>}

      {loading ? (
        <p>Loading faculty…</p>
      ) : faculty.length === 0 ? (
        !error && (
          <p className="section-description">
            No approved faculty found. Approve a faculty request first.
          </p>
        )
      ) : (
        <div className="permission-grid">
          {faculty.map((member) => (
            <article className="permission-card" key={member.id}>
              <h3>{member.full_name}</h3>
              <p className="section-description">
                {member.login_id} · {member.department}
              </p>
              <p className="section-description">
                {member.approved_designation}
              </p>

              <fieldset disabled={saving} className="permission-fieldset">
                <legend>Additional permissions</legend>

                {options.map((option) => (
                  <label className="permission-option" key={option.code}>
                    <input
                      type="checkbox"
                      checked={member.permissions.includes(option.code)}
                      onChange={(event) =>
                        changePermission(member, option, event.target.checked)
                      }
                    />
                    <span>{option.label}</span>
                  </label>
                ))}
              </fieldset>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}