# FleetOps local fleet dispatch app

- Frontend: React, TypeScript, Vite; backend: FastAPI, SQLAlchemy, PostgreSQL.
- Keep API contracts under `/api`; the frontend connects to `VITE_API_URL` and `/ws`.
- Run the stack locally with Docker Compose; see README.md.
- Implement package routing through station/cluster distance records and reserve idle vehicles atomically.
