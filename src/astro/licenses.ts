// Shipped as source, since the notices it serves are written by the package's own build.
import admin from "../../dist/admin/THIRD_PARTY_LICENSES.md?raw";
import styles from "../../dist/styles/THIRD_PARTY_LICENSES.md?raw";

export const GET = () => new Response(`${admin}\n${styles}`);
