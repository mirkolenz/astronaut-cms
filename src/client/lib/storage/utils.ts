import { useAuthStore } from "@client/stores/auth-store";

export function getToken(): string {
  const token = useAuthStore.getState().token;
  if (!token) throw new Error("Not authenticated");
  return token;
}

export function stripExtension(filename: string): string {
  const dot = filename.lastIndexOf(".");
  return dot === -1 ? filename : filename.slice(0, dot);
}

export function stripMediaPrefix(path: string, mediaDirectory: string): string {
  const prefix = mediaDirectory + "/";
  return path.startsWith(prefix) ? path.slice(prefix.length) : path;
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
