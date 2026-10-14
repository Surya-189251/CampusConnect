import { useEffect, useState } from "react";

const API_URL = "http://localhost:5000/api/admin/faculty-requests";

export default function AdminFaculty({ token }) {
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  async function loadRequests(signal) {
    setLoading(true);
    setError("");

    try {
      const response = await fetch(API_URL, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
        signal,
      });

      const data = await response.json();

      if (!response.ok) {
        setRequests([]);
        setError(data.message || "Could not load faculty requests.");
        return;
      }

      setRequests(data.requests);
    } catch (error) {
      if (error.name !== "AbortError") {
        setRequests([]);
        setError("Could not reach the backend.");
      }
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }

  useEffect(() => {
    const controller = new AbortController();
    loadRequests(controller.signal);

    return () => controller.abort();
    // Reload when the signed-in session changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  async function reviewRequest(event, request) {
    event.preventDefault();

    const decision = event.nativeEvent.submitter?.value;
    if (!["approved", "rejected"].includes(decision)) return;

    const fields = new FormData(event.currentTarget);
    const designation = String(fields.get("designation") || "").trim();
    const reason = String(fields.get("reason") || "").trim();

    setError("");
    setMessage("");

    if (decision === "approved" && !designation) {
      setError("Enter the designation before approving.");
      return;
    }

    if (decision === "rejected" && !reason) {
      setError("Enter a reason before rejecting.");
      return;
    }

    setSaving(true);

    try {
      const response = await fetch(`${API_URL}/${request.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          decision,
          designation,
          reason,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        setError(data.message || "Could not update the request.");
        return;
      }

      setRequests((previous) =>
        previous.filter((item) => item.id !== request.id)
      );
      setMessage(data.message);
    } catch {
      setError(
        "Connection interrupted. Refresh the requests to check whether the decision was saved."
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="faculty-admin-panel">
      <div className="section-heading">
        <div>
          <h2>Faculty Access Requests</h2>
          <p className="section-description">
            Review applicants from your college before granting access.
          </p>
        </div>

        <button
          className="button"
          disabled={loading || saving}
          onClick={() => loadRequests()}
        >
          Refresh Requests
        </button>
      </div>

      {error && <p className="auth-error" role="alert">{error}</p>}
      {message && <p className="faculty-success" role="status">{message}</p>}

      {loading ? (
        <p>Loading faculty requests…</p>
      ) : requests.length === 0 ? (
        !error && <p className="section-description">No pending requests.</p>
      ) : (
        <div className="faculty-request-list">
          {requests.map((request) => (
            <form
              className="faculty-request-card"
              key={request.id}
              onSubmit={(event) => reviewRequest(event, request)}
            >
              <h3>{request.full_name}</h3>

              <p>
                <strong>Faculty ID:</strong> {request.login_id}
              </p>
              <p>
                <strong>Email:</strong> {request.email}
              </p>
              <p>
                <strong>Department:</strong> {request.department}
              </p>
              <p>
                <strong>Requested designation:</strong>{" "}
                {request.requested_designation}
              </p>

              <label className="auth-field">
                <span>Approved designation</span>
                <input
                  name="designation"
                  defaultValue={request.requested_designation}
                  maxLength={100}
                  disabled={saving}
                />
              </label>

              <label className="auth-field">
                <span>Reason — required only when rejecting</span>
                <input
                  name="reason"
                  placeholder="Explain why the request cannot be approved"
                  maxLength={500}
                  disabled={saving}
                />
              </label>

              <div className="actions">
                <button
                  className="button primary"
                  type="submit"
                  value="approved"
                  disabled={saving}
                >
                  Approve
                </button>

                <button
                  className="button faculty-reject"
                  type="submit"
                  value="rejected"
                  disabled={saving}
                >
                  Reject
                </button>
              </div>
            </form>
          ))}
        </div>
      )}
    </section>
  );
}