import { NavLink, Outlet } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import "./AppShell.css";

export function AppShell() {
  const { me, logout } = useAuth();

  return (
    <div className="shell">
      <nav className="sidebar" aria-label="Primary">
        <div className="brand">Switchboard</div>
        <ul className="navlist">
          <li>
            <NavLink to="/today" className={({ isActive }) => (isActive ? "navlink active" : "navlink")}>
              Today&apos;s Work
            </NavLink>
          </li>
          <li>
            <NavLink to="/pipeline" className={({ isActive }) => (isActive ? "navlink active" : "navlink")}>
              Pipeline
            </NavLink>
          </li>
          <li>
            <NavLink to="/calendar" className={({ isActive }) => (isActive ? "navlink active" : "navlink")}>
              Calendar
            </NavLink>
          </li>
          <li>
            <NavLink to="/insights" className={({ isActive }) => (isActive ? "navlink active" : "navlink")}>
              Insights
            </NavLink>
          </li>
        </ul>
        <div className="sidebar-footer">
          <div className="who">
            <div className="who-name">{me?.fullName || me?.userId}</div>
            <div className="who-role">{me?.role}</div>
          </div>
          <button className="logout-btn" onClick={() => logout()}>
            Log out
          </button>
        </div>
      </nav>
      <main className="content">
        <Outlet />
      </main>
    </div>
  );
}
