import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider } from "./auth/AuthContext";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { AppShell } from "./components/AppShell";
import { LoginPage } from "./pages/LoginPage";
import { TodaysWorkPage } from "./pages/TodaysWorkPage";
import { PipelinePage } from "./pages/PipelinePage";
import { ComingSoonPage } from "./pages/ComingSoonPage";

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
              <Route path="calendar" element={<ComingSoonPage title="Calendar" />} />
              <Route path="insights" element={<ComingSoonPage title="Insights" />} />
            </Route>
          </Route>
          <Route path="*" element={<Navigate to="/today" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;
