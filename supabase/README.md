# DIGREE local database

Run these commands from the repository root with Docker running and Node.js 20 or newer. The CLI commands below use version 3.1.0.

```powershell
npx --yes supabase@3.1.0 start
npx --yes supabase@3.1.0 status
npx --yes supabase@3.1.0 db reset --local
npx --yes supabase@3.1.0 test db
```

Local Studio is available at http://localhost:54323. The app uses the `API_URL` and `ANON_KEY` from local status output. Keep keys in ignored local environment files.

The reset replaces the local database and loads synthetic Spring 2027 demo data. Run the account script after a reset to create two disposable sign-in accounts with separate `enrolled_self_reported` and `planned` records. The script prints generated credentials to the local terminal.

```powershell
powershell -File .\supabase\create-demo-users.ps1
```

See [DB_HANDOFF.md](./DB_HANDOFF.md) for integration.
