# FleetOps local run and end-to-end operator flow

This guide takes you from an empty local database to a manually created, assigned, tracked, and delivered package transfer. All example names and measurements below are values for **you to enter**; the app does not insert these records for you.

## 1. Start the Docker application

1. Start Docker Desktop and wait until its engine is running.
2. Open Terminal and start FleetOps from the repository directory:

   ```bash
   cd /Users/rohitsharma/Desktop/poc
   docker compose up --build -d
   ```

3. Check container status:

   ```bash
   docker compose ps
   ```

   The database and API should be `healthy`; the web container should be running.

4. Open the dashboard at <http://localhost:5173>. Optional endpoints:
   - API health: <http://localhost:8000/api/health> (expected response `{"status":"ok"}`)
   - Interactive API docs: <http://localhost:8000/docs>

For container logs, run `docker compose logs -f api web`; press `Ctrl+C` to stop following them. To stop the app without deleting saved data, run `docker compose down`.

## 2. Build your stations and cluster

1. In the sidebar, select **Stations** → **Add station**.
2. Enter a station name such as `Origin`.
3. Enter a cluster name such as `Test Campus`. The first station creates the cluster; later stations can use the same cluster name to join it.
4. Choose a cluster color and station capacity, then save.
5. Add a second station named `Destination` in the same cluster.

The map automatically lays out newly added stations for viewing. This is a visual layout, not a surveyed geographical coordinate. Configure actual route distances and travel times in the next step.

## 3. Configure a route between stations

1. Open **Network** → **Configure route**.
2. Choose `Origin` and `Destination`.
3. Enter the distance, for example `1.2 km`, and estimated travel time, for example `2 minutes`.
4. Save the route. It applies in both directions.

Routes are required for transfer assignment and ETA calculations. To dispatch a vehicle located at a different station from pickup, also configure a route from that vehicle’s station to the pickup station.

## 4. Add and configure a vehicle

1. Open **Vehicles** → **Add vehicle**.
2. Enter a vehicle name, such as `Test Cart`, and a unique fleet code, such as `TEST-01`.
3. Assign it to `Origin`.
4. Set its payload capacity (for example `25 kg`), battery level, and vehicle type.
5. Set availability to **Ready for dispatch**, then save.

An idle vehicle at the pickup station is the simplest setup for testing. Vehicles assigned to active transfers cannot be manually moved or have capacity changed until their transfer is complete.

## 5. Create, assign, and track a transfer

1. Select **New transfer** on Overview or Transfers.
2. Enter a package description, choose `Origin` as pickup and `Destination` as drop-off, and enter a package weight within the vehicle’s capacity.
3. Select **Assign transfer**. FleetOps verifies the route, finds the closest eligible idle vehicle, and reserves it atomically.
4. Open the transfer row to see its assigned vehicle and pickup/drop-off ETAs.
5. Confirm each real-world test stage using the detail panel:
   - **Confirm pickup** → Pickup
   - **Start delivery** → In Transit
   - **Mark delivered** → Delivered
6. After delivery, check **Vehicles** and **Stations**. The vehicle should be idle at `Destination`, and station availability should reflect the changed vehicle location.

If you cannot assign the transfer, check for a configured pickup-to-drop-off route, an idle vehicle with enough capacity, and—if needed—a configured vehicle-location-to-pickup route.

## 6. What to watch while it runs

- The UI receives changes through the `/ws` WebSocket and also refreshes a full snapshot every five seconds.
- ETA labels recalculate against the current clock every second. Configured route travel minutes determine the ETA; these are estimates.
- During an assigned/in-transit transfer, the map marker interpolates along the configured route from stored timestamps. This is a local simulation, **not live GPS** or a physical vehicle connection.
- Transfer stages are not advanced automatically: an operator confirms pickup, departure, and delivery in the UI.
- The live connection indicator shows WebSocket connection state. Snapshot polling can still refresh displayed data if the WebSocket reconnects.

## 7. Configure or reserve vehicles

- **Reserve** changes an idle vehicle to reserved so transfer assignment cannot take it.
- **Release** returns a manually reserved vehicle to idle.
- **Configure** updates eligible vehicle details, including station, capacity, battery, vehicle type, and maintenance/ready availability.
- Add a vehicle only after at least one station exists. Its name and fleet code must be unique.

## 8. Reset the local workspace

Saved records persist in the PostgreSQL Docker volume after containers stop. To stop and later restart without deleting your records:

```bash
docker compose down
docker compose up -d
```

To **permanently delete all** local stations, clusters, routes, vehicles, and transfers and start empty again:

```bash
docker compose down -v
docker compose up --build -d
```

## Troubleshooting

- **No data appears:** an empty workspace is expected on first start. Add stations, a route, and a vehicle in that order.
- **Add vehicle is unavailable:** create at least one station first.
- **Assign transfer is unavailable:** create at least two stations and a route first.
- **No eligible vehicle:** make sure a vehicle is idle, has capacity for the package, and has an approach route to pickup if it is not already at the pickup station.
- **API is not healthy:** inspect `docker compose ps` and `docker compose logs -f api db`; confirm Docker Desktop is running.
- **Need to remove old test records:** `docker compose down -v` is destructive and resets the workspace to empty.
