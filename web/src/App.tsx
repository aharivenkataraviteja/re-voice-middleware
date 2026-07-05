import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider } from "./auth/AuthContext";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { AppShell } from "./components/AppShell";
import { LoginPage } from "./pages/LoginPage";
import { TodaysWorkPage } from "./pages/TodaysWorkPage";
import { PipelinePage } from "./pages/PipelinePage";
import { CalendarPage } from "./pages/CalendarPage";
import { InsightsPage } from "./pages/InsightsPage";
import { CallDetailPage } from "./pages/CallDetailPage";

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route element={<ProtectedRoute />}>
            <Route element={<AppShell />}>
              <Route index element={<Navigate to="/today" replace />} />
              <Route path="today" element={<TodaysWorkPage />} />
              <Route path="pipeline" element={<PipelinePage />} />
              <Route path="calendar" element={<CalendarPage />} />
              <Route path="insights" element={<InsightsPage />} />
              <Route path="calls/:id" element={<CallDetailPage />} />
            </Route>
          </Route>
          <Route path="*" element={<Navigate to="/today" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;
