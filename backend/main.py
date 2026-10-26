from __future__ import annotations

import asyncio
import os
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from sqlalchemy import Float, ForeignKey, Integer, String, create_engine, select, update
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column, relationship

DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./fleetops.db")
engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {}, pool_pre_ping=True)


class Base(DeclarativeBase):
    pass


class Cluster(Base):
    __tablename__ = "clusters"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(80), unique=True)
    color: Mapped[str] = mapped_column(String(20), default="#258f76")
    stations: Mapped[list[Station]] = relationship(back_populates="cluster")


class Station(Base):
    __tablename__ = "stations"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(100), unique=True)
    cluster_id: Mapped[int] = mapped_column(ForeignKey("clusters.id"))
    x: Mapped[float] = mapped_column(Float, default=0)
    y: Mapped[float] = mapped_column(Float, default=0)
    capacity: Mapped[int] = mapped_column(Integer, default=12)
    cluster: Mapped[Cluster] = relationship(back_populates="stations")


class Distance(Base):
    __tablename__ = "distances"
    id: Mapped[int] = mapped_column(primary_key=True)
    from_station_id: Mapped[int] = mapped_column(ForeignKey("stations.id"))
    to_station_id: Mapped[int] = mapped_column(ForeignKey("stations.id"))
    distance_km: Mapped[float] = mapped_column(Float)
    travel_minutes: Mapped[int] = mapped_column(Integer)


class Vehicle(Base):
    __tablename__ = "vehicles"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(80), unique=True)
    code: Mapped[str] = mapped_column(String(20), unique=True)
    vehicle_type: Mapped[str] = mapped_column(String(40), default="Utility cart")
    capacity_kg: Mapped[int] = mapped_column(Integer, default=200)
    battery: Mapped[int] = mapped_column(Integer, default=90)
    status: Mapped[str] = mapped_column(String(30), default="idle")
    station_id: Mapped[int] = mapped_column(ForeignKey("stations.id"))


class Transfer(Base):
    __tablename__ = "transfers"
    id: Mapped[int] = mapped_column(primary_key=True)
    reference: Mapped[str] = mapped_column(String(30), unique=True)
    description: Mapped[str] = mapped_column(String(140))
    pickup_station_id: Mapped[int] = mapped_column(ForeignKey("stations.id"))
    dropoff_station_id: Mapped[int] = mapped_column(ForeignKey("stations.id"))
    vehicle_id: Mapped[int | None] = mapped_column(ForeignKey("vehicles.id"), nullable=True)
    status: Mapped[str] = mapped_column(String(30), default="queued")
    weight_kg: Mapped[int] = mapped_column(Integer, default=10)
    created_at: Mapped[datetime] = mapped_column(default=lambda: datetime.now(timezone.utc))
    eta_pickup: Mapped[datetime | None] = mapped_column(nullable=True)
    eta_dropoff: Mapped[datetime | None] = mapped_column(nullable=True)


class TransferIn(BaseModel):
    description: str = Field(min_length=2, max_length=140)
    pickup_station_id: int
    dropoff_station_id: int
    weight_kg: int = Field(default=10, gt=0)


class VehicleIn(BaseModel):
    name: str = Field(min_length=2, max_length=80)
    code: str = Field(min_length=2, max_length=20)
    vehicle_type: str = "Utility cart"
    capacity_kg: int = Field(default=200, gt=0)
    battery: int = Field(default=100, ge=0, le=100)
    station_id: int
    status: str = "idle"


class VehicleUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=2, max_length=80)
    code: str | None = Field(default=None, min_length=2, max_length=20)
    vehicle_type: str | None = Field(default=None, min_length=2, max_length=40)
    capacity_kg: int | None = Field(default=None, gt=0)
    battery: int | None = Field(default=None, ge=0, le=100)
    station_id: int | None = None
    status: str | None = None


class DistanceIn(BaseModel):
    from_station_id: int
    to_station_id: int
    distance_km: float = Field(gt=0)
    travel_minutes: int = Field(gt=0)


class StationIn(BaseModel):
    name: str = Field(min_length=2, max_length=100)
    cluster_name: str = Field(min_length=2, max_length=80)
    cluster_color: str = Field(default="#438c72", pattern=r"^#[0-9a-fA-F]{6}$")
    capacity: int = Field(default=12, gt=0)


subscribers: set[WebSocket] = set()


def seed() -> None:
    Base.metadata.create_all(engine)


@asynccontextmanager
async def lifespan(_: FastAPI):
    seed()
    yield


app = FastAPI(title="FleetOps API", version="1.0.0", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=os.getenv("CORS_ORIGINS", "http://localhost:5173").split(","), allow_credentials=True, allow_methods=["*"], allow_headers=["*"])


def station_info(db: Session, station_id: int) -> dict[str, Any]:
    s = db.get(Station, station_id)
    idle_vehicle = db.scalar(select(Vehicle.id).where(Vehicle.station_id == station_id, Vehicle.status == "idle").limit(1)) is not None
    return {"id": s.id, "name": s.name, "cluster_id": s.cluster_id, "cluster": db.get(Cluster,s.cluster_id).name, "color": db.get(Cluster,s.cluster_id).color, "x": s.x, "y": s.y, "capacity": s.capacity, "available": idle_vehicle}


def transfer_info(db: Session, t: Transfer) -> dict[str, Any]:
    start, end = db.get(Station,t.pickup_station_id), db.get(Station,t.dropoff_station_id)
    vehicle = db.get(Vehicle,t.vehicle_id) if t.vehicle_id else None
    return {"id":t.id,"reference":t.reference,"description":t.description,"pickup_station_id":start.id,"pickup_station":start.name,"dropoff_station_id":end.id,"dropoff_station":end.name,"vehicle_id":t.vehicle_id,"vehicle":vehicle.name if vehicle else None,"status":t.status,"weight_kg":t.weight_kg,"eta_pickup":t.eta_pickup.isoformat() if t.eta_pickup else None,"eta_dropoff":t.eta_dropoff.isoformat() if t.eta_dropoff else None}


def aware_utc(value: datetime) -> datetime:
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)


def vehicle_position(db: Session, vehicle: Vehicle, now: datetime) -> dict[str, Any]:
    """Interpolate an explicitly simulated position for active vehicle assignments.

    This is a local demo visualization based on route records and timestamps, not GPS.
    """
    origin = db.get(Station, vehicle.station_id)
    active = db.scalar(select(Transfer).where(
        Transfer.vehicle_id == vehicle.id,
        Transfer.status.in_(("assigned", "pickup", "in_transit")),
    ).order_by(Transfer.id.desc()).limit(1))
    if not active:
        return {"x": origin.x, "y": origin.y, "moving_to": None, "progress": 0.0, "has_assignment": False}

    if active.status == "assigned":
        destination = db.get(Station, active.pickup_station_id)
        route = db.scalar(select(Distance).where(
            Distance.from_station_id == origin.id,
            Distance.to_station_id == destination.id,
        ))
        duration = max(1, route.travel_minutes * 60) if route else 1
        elapsed = max(0.0, (now - aware_utc(active.created_at)).total_seconds())
        progress = min(1.0, elapsed / duration)
        moving_to = destination.name if progress < 1 else None
    elif active.status == "in_transit":
        origin = db.get(Station, active.pickup_station_id)
        destination = db.get(Station, active.dropoff_station_id)
        route = db.scalar(select(Distance).where(
            Distance.from_station_id == origin.id,
            Distance.to_station_id == destination.id,
        ))
        duration = max(1, route.travel_minutes * 60) if route else 1
        eta = aware_utc(active.eta_dropoff) if active.eta_dropoff else now
        started = eta - timedelta(seconds=duration)
        elapsed = max(0.0, (now - started).total_seconds())
        progress = min(1.0, elapsed / duration)
        moving_to = destination.name if progress < 1 else None
    else:
        destination = db.get(Station, active.pickup_station_id)
        route = db.scalar(select(Distance).where(
            Distance.from_station_id == origin.id,
            Distance.to_station_id == destination.id,
        ))
        duration = max(1, route.travel_minutes * 60) if route else 1
        eta = aware_utc(active.eta_pickup) if active.eta_pickup else now
        started = eta - timedelta(seconds=duration)
        elapsed = max(0.0, (now - started).total_seconds())
        progress = min(1.0, elapsed / duration)
        moving_to = None

    return {
        "x": origin.x + (destination.x - origin.x) * progress,
        "y": origin.y + (destination.y - origin.y) * progress,
        "moving_to": moving_to,
        "progress": round(progress, 3),
        "has_assignment": True,
    }


def snapshot() -> dict[str, Any]:
    with Session(engine) as db:
        now = datetime.now(timezone.utc)
        stations = [station_info(db,s.id) for s in db.scalars(select(Station).order_by(Station.id)).all()]
        clusters = [{"id":c.id,"name":c.name,"color":c.color,"station_count":len(c.stations)} for c in db.scalars(select(Cluster)).all()]
        vehicles = [{"id":v.id,"name":v.name,"code":v.code,"vehicle_type":v.vehicle_type,"capacity_kg":v.capacity_kg,"battery":v.battery,"status":v.status,"station_id":v.station_id,"station":db.get(Station,v.station_id).name,**vehicle_position(db,v,now)} for v in db.scalars(select(Vehicle).order_by(Vehicle.id)).all()]
        transfers = [transfer_info(db,t) for t in db.scalars(select(Transfer).order_by(Transfer.id.desc())).all()]
        distances = [{"id":d.id,"from_station_id":d.from_station_id,"to_station_id":d.to_station_id,"from_station":db.get(Station,d.from_station_id).name,"to_station":db.get(Station,d.to_station_id).name,"distance_km":d.distance_km,"travel_minutes":d.travel_minutes} for d in db.scalars(select(Distance).order_by(Distance.id)).all()]
        return {"stations":stations,"clusters":clusters,"vehicles":vehicles,"transfers":transfers,"distances":distances}


async def broadcast() -> None:
    if not subscribers: return
    data = snapshot()
    stale = []
    for ws in list(subscribers):
        try: await ws.send_json(data)
        except Exception: stale.append(ws)
    for ws in stale: subscribers.discard(ws)


@app.get("/api/health")
def health(): return {"status":"ok"}


@app.get("/api/snapshot")
def get_snapshot(): return snapshot()


@app.post("/api/stations")
async def create_station(payload: StationIn):
    with Session(engine) as db:
        cluster = db.scalar(select(Cluster).where(Cluster.name == payload.cluster_name.strip()))
        if not cluster:
            cluster = Cluster(name=payload.cluster_name.strip(), color=payload.cluster_color)
            db.add(cluster)
            db.flush()
        if db.scalar(select(Station.id).where(Station.name == payload.name.strip())):
            raise HTTPException(409, "A station with this name already exists")
        count = len(db.scalars(select(Station.id)).all())
        # Spread new stations across the map in a predictable grid; users can adjust
        # route distances and times separately in Network.
        x = 0.12 + (count % 4) * 0.24
        y = 0.16 + ((count // 4) % 3) * 0.28
        station = Station(name=payload.name.strip(), cluster_id=cluster.id, x=x, y=y, capacity=payload.capacity)
        db.add(station)
        db.commit()
        db.refresh(station)
        result = station_info(db, station.id)
    await broadcast()
    return result


@app.post("/api/transfers")
async def create_transfer(payload: TransferIn):
    with Session(engine) as db:
        start, end = db.get(Station,payload.pickup_station_id), db.get(Station,payload.dropoff_station_id)
        if not start or not end: raise HTTPException(404,"Pickup or drop-off station not found")
        if start.id == end.id: raise HTTPException(400,"Pickup and drop-off stations must differ")
        route = db.scalar(select(Distance).where(Distance.from_station_id==start.id,Distance.to_station_id==end.id))
        if not route: raise HTTPException(400,"No distance configured for this route")
        idle = db.scalars(select(Vehicle).where(Vehicle.status=="idle",Vehicle.capacity_kg>=payload.weight_kg).with_for_update(skip_locked=True)).all()
        if not idle: raise HTTPException(409,"No idle vehicle has sufficient capacity")
        # HLD routing: pick the eligible idle vehicle closest to the pickup cluster.
        def score(v: Vehicle) -> tuple[float,int]:
            if v.station_id == start.id:
                return (0, v.id)
            row = db.scalar(select(Distance).where(Distance.from_station_id==v.station_id,Distance.to_station_id==start.id))
            return (row.travel_minutes if row else 9999,v.id)
        candidates = [vehicle for vehicle in idle if score(vehicle)[0] < 9999]
        if not candidates:
            raise HTTPException(409,"No eligible vehicle has a configured route to the pickup station")
        candidates.sort(key=score)
        vehicle = None
        for candidate in candidates:
            # Conditional update provides a cross-database guard against double booking.
            claimed = db.execute(update(Vehicle).where(Vehicle.id == candidate.id, Vehicle.status == "idle").values(status="reserved"))
            if claimed.rowcount == 1:
                vehicle = candidate
                break
        if vehicle is None:
            db.rollback()
            raise HTTPException(409,"Eligible vehicles were just assigned; please retry")
        approach = score(vehicle)[0]
        now = datetime.now(timezone.utc)
        transfer = Transfer(reference="FO-PENDING",description=payload.description,pickup_station_id=start.id,dropoff_station_id=end.id,vehicle_id=vehicle.id,status="assigned",weight_kg=payload.weight_kg,eta_pickup=now+timedelta(minutes=approach),eta_dropoff=now+timedelta(minutes=approach+route.travel_minutes))
        db.add(transfer)
        db.flush()
        transfer.reference = f"FO-{2050 + transfer.id}"
        db.commit(); db.refresh(transfer)
        result=transfer_info(db,transfer)
    await broadcast()
    return result


@app.post("/api/vehicles")
async def create_vehicle(payload: VehicleIn):
    with Session(engine) as db:
        if payload.status not in ("idle", "maintenance"):
            raise HTTPException(400,"New vehicles must be idle or in maintenance")
        if not db.get(Station,payload.station_id): raise HTTPException(404,"Station not found")
        vehicle=Vehicle(name=payload.name,code=payload.code,vehicle_type=payload.vehicle_type,capacity_kg=payload.capacity_kg,battery=payload.battery,status=payload.status,station_id=payload.station_id)
        db.add(vehicle)
        try: db.commit()
        except Exception: db.rollback(); raise HTTPException(409,"Vehicle name or code already exists")
    await broadcast()
    return {"status":"created"}


@app.patch("/api/vehicles/{vehicle_id}")
async def update_vehicle(vehicle_id: int, payload: VehicleUpdate):
    with Session(engine) as db:
        vehicle = db.scalar(select(Vehicle).where(Vehicle.id == vehicle_id).with_for_update())
        if not vehicle:
            raise HTTPException(404,"Vehicle not found")
        changes = payload.model_dump(exclude_unset=True)
        if "station_id" in changes and not db.get(Station, changes["station_id"]):
            raise HTTPException(404,"Station not found")
        if "status" in changes and changes["status"] not in ("idle", "maintenance"):
            raise HTTPException(400,"Vehicles can only be configured as idle or maintenance")
        if vehicle.status in ("reserved", "in_transit") and any(key in changes for key in ("station_id", "capacity_kg", "status")):
            raise HTTPException(409,"Release the vehicle before changing its station, capacity, or status")
        for key, value in changes.items():
            setattr(vehicle, key, value)
        try:
            db.commit()
        except Exception:
            db.rollback()
            raise HTTPException(409,"Vehicle name or code already exists")
    await broadcast()
    return {"status":"updated"}


@app.patch("/api/vehicles/{vehicle_id}/reserve")
async def reserve_vehicle(vehicle_id: int):
    with Session(engine) as db:
        v=db.scalar(select(Vehicle).where(Vehicle.id==vehicle_id).with_for_update())
        if not v: raise HTTPException(404,"Vehicle not found")
        if v.status!="idle": raise HTTPException(409,"Only idle vehicles can be reserved")
        v.status="reserved"; db.commit()
    await broadcast(); return {"status":"reserved"}


@app.patch("/api/vehicles/{vehicle_id}/release")
async def release_vehicle(vehicle_id: int):
    with Session(engine) as db:
        v=db.get(Vehicle,vehicle_id)
        if not v: raise HTTPException(404,"Vehicle not found")
        if v.status != "reserved": raise HTTPException(409,"Only reserved vehicles can be released; maintenance vehicles must be configured as ready")
        v.status="idle"; db.commit()
    await broadcast(); return {"status":"idle"}


@app.put("/api/distances")
async def configure_distance(payload: DistanceIn):
    with Session(engine) as db:
        if payload.from_station_id==payload.to_station_id: raise HTTPException(400,"A station cannot route to itself")
        if not db.get(Station,payload.from_station_id) or not db.get(Station,payload.to_station_id): raise HTTPException(404,"Station not found")
        for a,b in ((payload.from_station_id,payload.to_station_id),(payload.to_station_id,payload.from_station_id)):
            row=db.scalar(select(Distance).where(Distance.from_station_id==a,Distance.to_station_id==b))
            if row: row.distance_km=payload.distance_km; row.travel_minutes=payload.travel_minutes
            else: db.add(Distance(from_station_id=a,to_station_id=b,distance_km=payload.distance_km,travel_minutes=payload.travel_minutes))
        db.commit()
    await broadcast(); return {"status":"updated"}


@app.patch("/api/transfers/{transfer_id}/advance")
async def advance_transfer(transfer_id: int):
    with Session(engine) as db:
        t=db.get(Transfer,transfer_id)
        if not t: raise HTTPException(404,"Transfer not found")
        sequence={"queued":"assigned","assigned":"pickup","pickup":"in_transit","in_transit":"delivered"}
        if t.status not in sequence: raise HTTPException(409,"Transfer is already complete")
        now = datetime.now(timezone.utc)
        t.status=sequence[t.status]
        if t.status == "pickup":
            t.eta_pickup = now
            if t.vehicle_id:
                db.get(Vehicle,t.vehicle_id).station_id = t.pickup_station_id
        elif t.status == "in_transit":
            route = db.scalar(select(Distance).where(Distance.from_station_id == t.pickup_station_id, Distance.to_station_id == t.dropoff_station_id))
            if route:
                t.eta_dropoff = now + timedelta(minutes=route.travel_minutes)
            if t.vehicle_id:
                db.get(Vehicle,t.vehicle_id).status = "in_transit"
        elif t.status=="delivered" and t.vehicle_id:
            t.eta_dropoff = now
            v=db.get(Vehicle,t.vehicle_id); v.status="idle"; v.station_id=t.dropoff_station_id
        result_status = t.status
        db.commit()
    await broadcast(); return {"status":result_status}


@app.websocket("/ws")
async def websocket_endpoint(ws: WebSocket):
    await ws.accept(); subscribers.add(ws)
    try:
        await ws.send_json(snapshot())
        while True: await ws.receive_text()
    except WebSocketDisconnect: subscribers.discard(ws)
