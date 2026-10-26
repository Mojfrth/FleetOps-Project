# FleetOps — local fleet dispatch

FleetOps is a Docker-based fleet dispatch application for a campus, warehouse, or other station-based site. It follows the supplied HLD: stations belong to clusters, transfers connect pickup and drop-off stations, configured station-to-station distances and travel times drive routing/ETAs, and assignment reserves an eligible idle vehicle.

The database starts **empty**. There are no sample stations, vehicles, routes, or transfers. Set up your own records using the dashboard and the instructions in [LOCAL_DEMO_GUIDE.md](LOCAL_DEMO_GUIDE.md).

## Technology stack

| Layer | Technology | Role |
|---|---|---|
| Web UI | React, TypeScript, Vite | Single-page operations dashboard; development server is exposed on port 5173. |
| UI icons and styling | lucide-react, CSS | Dashboard icons, responsive styling, persistent light/dark themes. |
| API | Python 3.12, FastAPI, Pydantic | REST endpoints under `/api`, validation, OpenAPI docs, and WebSocket endpoint `/ws`. |
| Persistence | SQLAlchemy 2, PostgreSQL 16 | Stores clusters, stations, directed route records, vehicles, and transfers. |
| Database driver | psycopg 3 | FastAPI/SQLAlchemy PostgreSQL connectivity. |
| Local orchestration | Docker Compose | Starts PostgreSQL, API, and web containers; health checks gate startup. |

## Start locally with Docker

Prerequisite: install and start Docker Desktop. From the project directory:

```bash
docker compose up --build -d
docker compose ps
```

Wait for the database and API to show `healthy`. Open:

- Dashboard: <http://localhost:5173>
- API health: <http://localhost:8000/api/health>
- Interactive API docs: <http://localhost:8000/docs>

The full clean-workspace workflow, including setup order and an end-to-end transfer, is in [LOCAL_DEMO_GUIDE.md](LOCAL_DEMO_GUIDE.md).

### First-time workspace setup

After a clean reset, the dashboard has no records. Create at least two stations (Stations → **Add station**), configure a route between them (Network → **Configure route**), add an idle vehicle at a station (Vehicles → **Add vehicle**), and then create a transfer (Overview or Transfers → **New transfer**). Open the created transfer and confirm **pickup**, **in transit**, and **delivered** as those stages occur. The **LOCAL_DEMO_GUIDE.md** document includes detailed steps and example values.

Stop the containers without deleting data:

```bash
docker compose down
```

Start the existing database again with `docker compose up -d`. PostgreSQL data persists in the `fleetops-db` Docker volume. **Destructive reset:** `docker compose down -v` deletes all local records; the next startup returns to a clean empty workspace.

## Implemented capabilities

- **Create stations and clusters:** the Stations page creates stations and either creates or reuses their cluster. The map lays new stations out automatically; cluster color and station capacity are configurable.
- **Configure the station network:** view routes on a network map and configure bidirectional distance/travel-time records. A route must exist for the transfer leg, and a vehicle away from pickup needs an approach route.
- **Manage vehicles:** add vehicles at real stations, configure type, fleet code, capacity, battery, station, and idle/maintenance status; manually reserve idle vehicles and release reserved vehicles.
- **Assign package transfers:** create a transfer with description, pickup, drop-off, and weight. The API validates the route and payload capacity, chooses the closest eligible idle vehicle, and reserves it atomically to prevent double assignment.
- **Follow dispatch stages:** operator-confirmed transitions are Assigned → Pickup → In Transit → Delivered. Delivery puts the vehicle back to idle at the destination station.
- **Track station availability:** maps and station lists show station markers and ready/total vehicle counts.
- **See pickup/drop-off ETAs:** ETAs are based on configured travel minutes and the current timestamp. The UI countdown refreshes every second.
- **View moving vehicle markers:** for active transfers, the backend interpolates a marker along the configured route using transfer timestamps; the dashboard receives state over WebSocket and also polls snapshots every five seconds.
- **Theme preference:** switch between light and dark themes; the selection persists in browser local storage.

### Requirement coverage

| Requested capability | Where to use it |
|---|---|
| Assign package transfers | Overview or Transfers → **New transfer**; assignment chooses and reserves a suitable idle vehicle. |
| See live vehicle status | Overview and Vehicles; status changes are broadcast over WebSocket and snapshots refresh periodically. |
| Map station availability | Overview and Stations maps; markers show station names and idle/total vehicle counts. |
| View/configure station distances | Network lists routes and **Configure route** saves a bidirectional distance/time. |
| Configure and reserve vehicles | Vehicles → **Add vehicle**, **Configure**, **Reserve**, and **Release**. |
| See pickup/drop-off ETAs | Transfers table and transfer detail show countdowns based on the current timestamp and configured route times. |

## API surface

All HTTP API contracts are under `/api`:

| Method | Endpoint | Purpose |
|---|---|---|
| `GET` | `/api/health` | Container/API health check. |
| `GET` | `/api/snapshot` | Current clusters, stations, availability, vehicles, transfers, route records, and simulated vehicle coordinates. |
| `POST` | `/api/stations` | Create a station and create/reuse its cluster. |
| `POST` | `/api/vehicles` | Add a vehicle at an existing station. |
| `PATCH` | `/api/vehicles/{id}` | Configure an eligible vehicle. |
| `PATCH` | `/api/vehicles/{id}/reserve` | Reserve an idle vehicle. |
| `PATCH` | `/api/vehicles/{id}/release` | Release a manually reserved vehicle. |
| `PUT` | `/api/distances` | Create/update a bidirectional distance/time record. |
| `POST` | `/api/transfers` | Create a transfer and automatically reserve a suitable vehicle. |
| `PATCH` | `/api/transfers/{id}/advance` | Confirm the next dispatch stage. |
| WebSocket | `/ws` | Send an initial snapshot and broadcast updates after API changes. |

FastAPI OpenAPI/Swagger UI is at <http://localhost:8000/docs>.

## Repository layout

- `frontend/` — React/TypeScript/Vite UI, CSS themes, browser API/WebSocket client.
- `backend/` — FastAPI application, SQLAlchemy data model, validation, routing, ETA/position calculations.
- `docker-compose.yml` — PostgreSQL, API, and web services plus health checks and persistent database volume.
- `LOCAL_DEMO_GUIDE.md` — step-by-step startup, manual configuration, dispatch, and live-check instructions.

## What “live” means (and does not mean)

The dashboard receives API state updates over WebSocket, reconnects automatically, polls a snapshot every five seconds, and recalculates ETA countdown labels every second. Vehicle markers for active transfers are **simulated** from route distance/time records and timestamps. This project does not connect to physical vehicles or GPS, model real traffic, or automatically confirm pickup/delivery. An operator advances each dispatch stage in the UI. Use a real telemetry provider and production authentication/authorization before operational deployment.

## Local development without Docker (optional)

The supported and simplest local setup is Docker Compose. For code work, run the frontend from `frontend/` with `npm install` then `npm run dev`; run the API from `backend/` with the dependencies in `requirements.txt` and `uvicorn main:app --reload`. Point `DATABASE_URL` at a PostgreSQL instance and set `VITE_API_URL` for the browser. Docker Compose configures these connections for the bundled local stack.

## Production-readiness notes

This is an unauthenticated local MVP, not a production deployment. Before exposing it beyond a trusted local environment, add authentication and authorization, schema migrations, secure secret management, audit logging, operational monitoring, backups, and an integration with verified physical vehicle telemetry if true live location is required.
