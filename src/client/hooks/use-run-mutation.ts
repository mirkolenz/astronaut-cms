import type { UseMutationResult } from "@tanstack/react-query";
import { toast } from "@/client/components/toast";
import { useWriteError } from "@/client/hooks/use-write-error";

interface RunOptions<TData> {
  /** Left out for a write whose result shows by itself, such as a reorder. */
  success?: string;
  onSuccess?: (data: TData) => void;
  /** Words a failure the caller knows better, the usual words apply otherwise. */
  describeError?: (error: unknown) => string | undefined;
}

type RunMutation = <TData, TVariables, TContext>(
  mutation: UseMutationResult<TData, Error, TVariables, TContext>,
  variables: TVariables,
  options?: RunOptions<TData>,
) => void;

/** Runs a write the way every action does, toasting its success or its failure. */
export function useRunMutation(): RunMutation {
  const writeError = useWriteError();

  return (mutation, variables, { success, onSuccess, describeError } = {}) => {
    mutation.mutate(variables, {
      onSuccess: (data) => {
        onSuccess?.(data);

        if (success) toast(success, "success");
      },
      onError: (error) => toast(describeError?.(error) ?? writeError(error), "error"),
    });
  };
}
