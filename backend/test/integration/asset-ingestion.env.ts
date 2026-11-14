// Imported before the harness so env.ts sees a 1 MB upload limit: the
// oversized-upload tests send 2 MB instead of 101 MB.
process.env.ASSET_MAX_UPLOAD_BYTES = String(1024 * 1024);
