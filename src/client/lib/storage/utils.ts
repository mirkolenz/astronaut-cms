import { relative } from "pathe";
import { useAuthStore } from "@client/stores/auth-store";

export function tryGetToken(): string | undefined {
  return useAuthStore.getState().session?.accessToken;
}

export function getToken(): string {
  const token = tryGetToken();
  if (!token) throw new Error("Not authenticated");
  return token;
}

export function stripExtension(filename: string): string {
  const dot = filename.lastIndexOf(".");
  return dot === -1 ? filename : filename.slice(0, dot);
}

/** The library-relative form of a repository path, or null when it is outside the library. */
export function stripMediaPrefix(path: string, mediaDirectory: string): string | null {
  const rel = relative(mediaDirectory, path);

  return rel.startsWith("..") ? null : rel;
}

export async function fileToBase64(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}
