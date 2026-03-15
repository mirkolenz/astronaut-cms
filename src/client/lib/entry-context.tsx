import { createContext, useContext } from "react";

interface EntryContextValue {
  contentFilePath: string;
}

const EntryContext = createContext<EntryContextValue | null>(null);

export const EntryContextProvider = EntryContext.Provider;

export function useEntryContext(): EntryContextValue | null {
  return useContext(EntryContext);
}
