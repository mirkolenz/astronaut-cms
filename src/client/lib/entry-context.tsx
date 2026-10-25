import { createContext, useContext } from "react";

/** The file of the entry being edited, which relative asset references resolve against. */
const EntryContext = createContext<string | undefined>(undefined);

export const EntryContextProvider = EntryContext.Provider;

export function useEntryContext(): string | undefined {
  return useContext(EntryContext);
}
