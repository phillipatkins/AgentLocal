# WhatsApp Bot Architecture: Improved Plan (2026)

## Key Changes Introduced
- All file I/O migrated to async patterns (`core/async_fs.js`).
- Data (browser sessions, memory, file, state) now per chat/session (`sessions/sessionManager.js`).
- Robust error handling via central logger/handler (`core/errorHandler.js`).
- All toolkit/utility logic deduplicated and referenced, not duplicated.
- All external binary locations/configs in `config.defaults.js` (no hardcoded binary or path dependencies).
- Risky operations (file delete, shell, sensitive browser ops) now gated by guard checks (`core/security.js`).
- Lightweight background job queue added for heavy/slow or bulk jobs (`core/jobQueue.js`).
- /doctor/diagnostic system added (`core/dependencyCheck.js`).

## Migration/Upgrade Steps
1. Migrate all synchronous file ops in app code to use `async_fs.js` utilities (search for `fs.readFileSync` etc.).
2. Store/retrieve session-local info with `sessionManager`, no more global vars.
3. Replace repeated utilities with shared imports from central modules.
4. Place all config/defaults in `config.defaults.js` and load/override as needed.
5. Move privilege checks into `security.js` for any operation that can mutate outside workspace.
6. Move all background (heavy/slow) operations to the job queue rather than blocking message/event loop.

---
See each helper’s JS docstring for usage. For code/PR diffs, see next check-in or ask for sample file diffs for any main entry point.
