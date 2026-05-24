import { QueryClient } from "@tanstack/react-query";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      refetchOnWindowFocus: false,
      networkMode: "offlineFirst",
    },
    mutations: {
      retry: false,
      networkMode: "offlineFirst",
    },
  },
});
