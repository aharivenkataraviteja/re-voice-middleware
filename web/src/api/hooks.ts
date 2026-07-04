import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "./client";
import type {
  TodayResponse,
  LeadsResponse,
  LeadDetail,
  Lead,
  TasksResponse,
  Task,
  AppointmentsResponse,
  Appointment,
  UsersResponse,
} from "./types";

// Short staleTime on Today's Work — the one screen that's meant to feel
// "live"; everything else defaults to refetch-on-focus instead of polling.
export function useToday() {
  return useQuery({
    queryKey: ["today"],
    queryFn: () => api.get<TodayResponse>("/api/v1/today"),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}

export function useLeads(params: { stage?: string; search?: string } = {}) {
  const qs = new URLSearchParams();
  if (params.stage) qs.set("stage", params.stage);
  if (params.search) qs.set("search", params.search);
  const query = qs.toString();
  return useQuery({
    queryKey: ["leads", params],
    queryFn: () => api.get<LeadsResponse>(`/api/v1/leads${query ? `?${query}` : ""}`),
    staleTime: 30_000,
  });
}

export function useLead(id: string | null) {
  return useQuery({
    queryKey: ["leads", id],
    queryFn: () => api.get<LeadDetail>(`/api/v1/leads/${id}`),
    enabled: !!id,
  });
}

export function useUpdateLead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Partial<Lead> }) =>
      api.patch<{ lead: Lead }>(`/api/v1/leads/${id}`, patch),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["leads"] });
      qc.invalidateQueries({ queryKey: ["today"] });
    },
  });
}

export function useCreateLead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { callerName: string; phone?: string; email?: string; intent?: string }) =>
      api.post<{ lead: Lead }>("/api/v1/leads", body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["leads"] }),
  });
}

export function useAddTimelineEvent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ leadId, ...body }: { leadId: string; eventType: string; notes?: string }) =>
      api.post(`/api/v1/leads/${leadId}/timeline`, body),
    onSuccess: (_data, variables) => qc.invalidateQueries({ queryKey: ["leads", variables.leadId] }),
  });
}

export function useTasks(params: { status?: string; leadId?: string } = {}) {
  const qs = new URLSearchParams();
  if (params.status) qs.set("status", params.status);
  if (params.leadId) qs.set("leadId", params.leadId);
  const query = qs.toString();
  return useQuery({
    queryKey: ["tasks", params],
    queryFn: () => api.get<TasksResponse>(`/api/v1/tasks${query ? `?${query}` : ""}`),
  });
}

export function useUpdateTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Partial<Task> }) =>
      api.patch<{ task: Task }>(`/api/v1/tasks/${id}`, patch),
    // Optimistic update: task-complete is one of the two highest-value
    // candidates identified in the frontend readiness review.
    onMutate: async ({ id, patch }) => {
      await qc.cancelQueries({ queryKey: ["today"] });
      const previous = qc.getQueryData<TodayResponse>(["today"]);
      if (previous) {
        qc.setQueryData<TodayResponse>(["today"], {
          ...previous,
          overdueTasks:
            patch.status && patch.status !== "open"
              ? previous.overdueTasks.filter((t) => t.id !== id)
              : previous.overdueTasks,
        });
      }
      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) qc.setQueryData(["today"], context.previous);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["today"] });
      qc.invalidateQueries({ queryKey: ["tasks"] });
    },
  });
}

export function useAppointments(params: { from?: string; to?: string } = {}) {
  const qs = new URLSearchParams();
  if (params.from) qs.set("from", params.from);
  if (params.to) qs.set("to", params.to);
  const query = qs.toString();
  return useQuery({
    queryKey: ["appointments", params],
    queryFn: () => api.get<AppointmentsResponse>(`/api/v1/appointments${query ? `?${query}` : ""}`),
  });
}

export function useUpdateAppointment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Partial<Appointment> }) =>
      api.patch<{ appointment: Appointment }>(`/api/v1/appointments/${id}`, patch),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["appointments"] });
      qc.invalidateQueries({ queryKey: ["today"] });
    },
  });
}

// Long staleTime — the user list rarely changes and is needed on nearly
// every page (assignee/leaderboard name resolution), so it's worth caching
// aggressively rather than refetching per page, per the readiness review.
export function useUsers() {
  return useQuery({
    queryKey: ["users"],
    queryFn: () => api.get<UsersResponse>("/api/v1/users"),
    staleTime: 5 * 60_000,
  });
}
