/**
 * How a {@link MediaStore} is built from configuration and credentials.
 *
 * The injected route builds it from the environment of a running function.
 */
import type { MediaServerConfig } from "../integration/types.ts";
import type { BindingReader, EnvReader } from "../shared/runtime-env.ts";
import {
  S3_ACCESS_KEY_ID_ENV,
  S3_SECRET_ACCESS_KEY_ENV,
  S3_SESSION_TOKEN_ENV,
} from "../shared/media.ts";
import { S3Store } from "./s3-store.ts";
import { BindingStore, type MediaStore, type R2Binding } from "./store.ts";

export function openStore(
  media: MediaServerConfig,
  getEnv: EnvReader,
  getBinding: BindingReader,
): MediaStore {
  const { access } = media;

  if (access.type === "binding") {
    const binding = getBinding(access.name);

    if (!binding) throw new Error(`The R2 binding "${access.name}" is not available in this runtime.`);

    return new BindingStore(binding as R2Binding);
  }

  const accessKeyId = getEnv(S3_ACCESS_KEY_ID_ENV);
  const secretAccessKey = getEnv(S3_SECRET_ACCESS_KEY_ENV);

  if (!accessKeyId || !secretAccessKey) {
    throw new Error(
      `Media storage credentials are missing: set ${S3_ACCESS_KEY_ID_ENV} and ${S3_SECRET_ACCESS_KEY_ENV}.`,
    );
  }

  return new S3Store(
    { ...access, bucket: media.bucket },
    { accessKeyId, secretAccessKey, sessionToken: getEnv(S3_SESSION_TOKEN_ENV) },
  );
}
