# PostgreSQL setup

1. PostgreSQL 18 is already installed and listening on localhost:5432.
2. Open pgAdmin or SQL Shell using your PostgreSQL administrator password.
3. Create a dedicated login and database (replace the example password):

   ```sql
   CREATE ROLE translator LOGIN PASSWORD 'choose-a-strong-password';
   CREATE DATABASE language_app OWNER translator;
   ```

4. Set this in backend/.env, URL-encoding special characters in the password:

   ```dotenv
   DATABASE_URL=postgresql://translator:YOUR_PASSWORD@localhost:5432/language_app
   ```

5. From the backend folder run:

   ```powershell
   npm install
   npm run db:migrate
   npm start
   ```

6. Open http://127.0.0.1:3000, translate something, Save, reload and Load it.

The SQL migration creates saved_translations and its indexes without deleting
existing records. The server does not change schema automatically at startup.
Use a dedicated database login, not the postgres superuser, for normal app use.
For a hosted database use its verified TLS connection string (sslmode=verify-full).
Never disable certificate validation to work around a connection problem.

## How storage works

The browser calls GET/POST /api/saved-translations and DELETE
/api/saved-translations/:id. PostgreSQL stores saved source text, translated text,
languages and timestamps. Unsaved text and audio are not persisted by this app.
A random HttpOnly SameSite cookie identifies the anonymous browser; only a hash
of that token is stored with each row. Every query checks ownership. Production
cookies use Secure and require HTTPS. This is not an account system: other devices
cannot recover the same saves, and clearing/expiring the cookie loses access to
its records (it does not delete the database records). Add accounts for sync/recovery.
The newest 100 saves per browser are retained. Duplicate source/language pairs are
updated. Writes use transactions and parameterized SQL.

Old localStorage saves are left untouched and are not automatically uploaded.
A database outage reports an error instead of silently saving somewhere else.
Back up the database normally with PostgreSQL tooling; browser storage is no longer
a backup. Anonymous abandoned records require an operator retention policy.

## Tests

npm test runs mocked API/frontend tests. To run the real PostgreSQL test too,
set TEST_DATABASE_URL to a dedicated test database and run npm test. This test
creates the schema if absent, uses random owners, checks persistence after a pool
restart, duplicate updates, SQL-like input, owner isolation and delete. It cleans
up its own rows. Do not use a production database for testing.

## Render update

Keep Root Directory blank. Build: npm --prefix backend ci && npm --prefix backend test
Start: node backend/server.js
Set DATABASE_URL in Render's environment, using a database reachable from Render
(localhost on your PC is not reachable there). Run the migration against that
database before serving traffic: npm --prefix backend run db:migrate.
Retain HOST=0.0.0.0 and APP_ORIGIN=https://YOUR-APP.onrender.com.
