import { useUsers } from "./hooks";

export function useUserNameLookup() {
  const { data } = useUsers();
  return (userId: string | null | undefined): string => {
    if (!userId) return "Unassigned";
    const user = data?.users.find((u) => u.id === userId);
    return user?.fullName || user?.email || "Unknown";
  };
}
