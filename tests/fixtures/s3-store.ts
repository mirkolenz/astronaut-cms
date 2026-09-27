// Stand-in for `virtual:astronaut-cms/s3-store`, which the integration links to
// the real S3 client only when the media library is reached through S3.
export const loadS3Store = () => import("@/media/s3-store").then((m) => m.S3Store);
