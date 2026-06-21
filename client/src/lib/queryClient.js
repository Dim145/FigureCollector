import { QueryClient, MutationCache } from "@tanstack/react-query";

export const queryClient = new QueryClient({
  // Surface every failed mutation as a toast. queryClient is a plain module (no
  // React context), so it dispatches a window event that the ToastProvider
  // listens for and turns into toast.error(mapApiError(error, t)).
  mutationCache: new MutationCache({
    onError: (error) => {
      if (typeof window !== "undefined") {
        window.dispatchEvent(
          new CustomEvent("figurecollector:mutation-error", { detail: { error } }),
        );
      }
    },
  }),
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
