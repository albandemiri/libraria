// Imported before the harness so the request log (an info line per request) is
// emitted and the redaction test can inspect it.
process.env.LOG_LEVEL = 'info';
