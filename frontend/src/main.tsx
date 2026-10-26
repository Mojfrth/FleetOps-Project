import { useCallback, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  ArrowLeftRight, ArrowRight, Battery, Check, Clock3, LayoutDashboard,
  MapPin, Moon, Navigation, Package, Plus, Route, Search, ShieldCheck,
  Sun, Truck, X,
} from 'lucide-react';
import './style.css';
import './theme.css';

type Station = { id: number; name: string; cluster_id: number; cluster: string; color: string; x: number; y: number; capacity: number; available: boolean };
type Cluster = { id: number; name: string; color: string; station_count: number };
type Vehicle = { id: number; name: string; code: string; vehicle_type: string; capacity_kg: number; battery: number; status: string; station_id: number; station: string; x: number; y: number; moving_to: string | null; progress: number; has_assignment: boolean };
type Transfer = { id: number; reference: string; description: string; pickup_station_id: number; pickup_station: string; dropoff_station_id: number; dropoff_station: string; vehicle_id: number | null; vehicle: string | null; status: string; weight_kg: number; eta_pickup: string | null; eta_dropoff: string | null };
type Distance = { id: number; from_station_id: number; to_station_id: number; from_station: string; to_station: string; distance_km: number; travel_minutes: number };
type Snapshot = { stations: Station[]; clusters: Cluster[]; vehicles: Vehicle[]; transfers: Transfer[]; distances: Distance[] };
type Page = 'Overview' | 'Transfers' | 'Vehicles' | 'Stations' | 'Network';
type Modal = '' | 'transfer' | 'vehicle' | 'station' | 'distance';

const API = import.meta.env.VITE_API_URL || 'http://localhost:8000';
const EMPTY: Snapshot = { stations: [], clusters: [], vehicles: [], transfers: [], distances: [] };

async function request<T = unknown>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = body.detail;
    throw new Error(typeof detail === 'string' ? detail : 'Request failed. Check the values and try again.');
  }
  return body as T;
}

function eta(value: string | null, now: number): string {
  if (!value) return '—';
  const date = new Date(value);
  const clock = new Intl.DateTimeFormat('en', { hour: 'numeric', minute: '2-digit' }).format(date);
  const minutes = Math.ceil((date.getTime() - now) / 60_000);
  return `${clock} · ${minutes <= 0 ? 'due now' : `in ${minutes}m`}`;
}

function App() {
  const [data, setData] = useState<Snapshot>(EMPTY);
  const [page, setPage] = useState<Page>('Overview');
  const [online, setOnline] = useState(false);
  const [dark, setDark] = useState(() => localStorage.getItem('fleetops-theme') === 'dark');
  const [now, setNow] = useState(Date.now());
  const [modal, setModal] = useState<Modal>('');
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState('');
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const [stationName, setStationName] = useState('');
  const [clusterName, setClusterName] = useState('');
  const [clusterColor, setClusterColor] = useState('#438c72');
  const [stationCapacity, setStationCapacity] = useState('12');

  const [vehicleName, setVehicleName] = useState('');
  const [vehicleCode, setVehicleCode] = useState('');
  const [vehicleStation, setVehicleStation] = useState('');
  const [vehicleType, setVehicleType] = useState('Utility cart');
  const [vehicleCapacity, setVehicleCapacity] = useState('200');
  const [vehicleBattery, setVehicleBattery] = useState('100');
  const [vehicleStatus, setVehicleStatus] = useState('idle');
  const [editingVehicle, setEditingVehicle] = useState<Vehicle | null>(null);

  const [description, setDescription] = useState('');
  const [pickupId, setPickupId] = useState('');
  const [dropoffId, setDropoffId] = useState('');
  const [weight, setWeight] = useState('');
  const [distanceFrom, setDistanceFrom] = useState('');
  const [distanceTo, setDistanceTo] = useState('');
  const [distanceKm, setDistanceKm] = useState('');
  const [travelMinutes, setTravelMinutes] = useState('');

  const refresh = useCallback(async () => {
    try { setData(await request<Snapshot>('/api/snapshot')); } catch { /* keep the last good snapshot while reconnecting */ }
  }, []);

  useEffect(() => {
    let stopped = false;
    let retry: ReturnType<typeof setTimeout>;
    let socket: WebSocket;
    const connect = () => {
      if (stopped) return;
      socket = new WebSocket(`${API.replace(/^http/, 'ws')}/ws`);
      socket.onopen = () => setOnline(true);
      socket.onmessage = event => {
        try { setData(JSON.parse(event.data) as Snapshot); } catch { /* ignore malformed messages */ }
      };
      socket.onclose = () => {
        setOnline(false);
        if (!stopped) retry = setTimeout(connect, 2_000);
      };
      socket.onerror = () => socket.close();
    };
    void refresh();
    connect();
    const poll = setInterval(() => void refresh(), 5_000);
    return () => { stopped = true; clearTimeout(retry); clearInterval(poll); socket?.close(); };
  }, [refresh]);

  useEffect(() => {
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    localStorage.setItem('fleetops-theme', dark ? 'dark' : 'light');
  }, [dark]);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    const ids = data.stations.map(station => String(station.id));
    if (!ids.length) return;
    if (!ids.includes(pickupId)) setPickupId(ids[0]);
    if (!ids.includes(dropoffId)) setDropoffId(ids.find(id => id !== ids[0]) || '');
    if (!ids.includes(vehicleStation)) setVehicleStation(ids[0]);
    if (!ids.includes(distanceFrom)) setDistanceFrom(ids[0]);
    if (!ids.includes(distanceTo)) setDistanceTo(ids.find(id => id !== ids[0]) || '');
  }, [data.stations, pickupId, dropoffId, vehicleStation, distanceFrom, distanceTo]);

  const notify = (message: string) => {
    setToast(message);
    setTimeout(() => setToast(''), 3_500);
  };
  const runAction = async (operation: () => Promise<unknown>, message: string) => {
    setBusy(true);
    try { await operation(); await refresh(); setModal(''); notify(message); }
    catch (error) { notify(error instanceof Error ? error.message : 'Request failed'); }
    finally { setBusy(false); }
  };

  const active = data.transfers.filter(transfer => !['delivered', 'cancelled'].includes(transfer.status));
  const idleCount = data.vehicles.filter(vehicle => vehicle.status === 'idle').length;
  const movingCount = data.vehicles.filter(vehicle => ['reserved', 'in_transit'].includes(vehicle.status)).length;
  const selected = data.transfers.find(transfer => transfer.id === selectedId) || null;
  const filteredTransfers = useMemo(() => data.transfers.filter(transfer =>
    `${transfer.reference} ${transfer.description} ${transfer.pickup_station} ${transfer.dropoff_station}`.toLowerCase().includes(search.toLowerCase())), [data.transfers, search]);

  const openVehicleForm = (vehicle?: Vehicle) => {
    setEditingVehicle(vehicle || null);
    setVehicleName(vehicle?.name || '');
    setVehicleCode(vehicle?.code || '');
    setVehicleStation(String(vehicle?.station_id || data.stations[0]?.id || ''));
    setVehicleType(vehicle?.vehicle_type || 'Utility cart');
    setVehicleCapacity(String(vehicle?.capacity_kg || 200));
    setVehicleBattery(String(vehicle?.battery ?? 100));
    setVehicleStatus(vehicle?.status === 'maintenance' ? 'maintenance' : 'idle');
    setModal('vehicle');
  };

  const createTransfer = async () => {
    const result = await request<Transfer>('/api/transfers', {
      method: 'POST',
      body: JSON.stringify({ description, pickup_station_id: Number(pickupId), dropoff_station_id: Number(dropoffId), weight_kg: Number(weight) }),
    });
    await refresh();
    setSelectedId(result.id);
    setPage('Transfers');
    setModal('');
    notify(`Transfer ${result.reference} assigned; pickup and drop-off ETAs are live.`);
  };

  const NetworkMap = ({ large = false }: { large?: boolean }) => (
    <div className={`network-map ${large ? 'network-large' : ''}`}>
      <svg className="routes" viewBox="0 0 100 70" preserveAspectRatio="none">
        {data.distances.filter(route => route.from_station_id < route.to_station_id).map(route => {
          const from = data.stations.find(station => station.id === route.from_station_id);
          const to = data.stations.find(station => station.id === route.to_station_id);
          if (!from || !to) return null;
          return <line key={route.id} x1={from.x * 100} y1={from.y * 100} x2={to.x * 100} y2={to.y * 100} className="route-line" />;
        })}
      </svg>
      {data.stations.map(station => {
        const vehicles = data.vehicles.filter(vehicle => vehicle.station_id === station.id);
        const ready = vehicles.filter(vehicle => vehicle.status === 'idle').length;
        return <button key={station.id} className={`map-node ${ready ? '' : 'node-busy'}`} style={{ left: `${station.x * 100}%`, top: `${station.y * 100}%`, '--station-color': station.color } as React.CSSProperties} title={`${station.name} · ${ready} ready`} onClick={() => notify(`${station.name}: ${ready} ready of ${vehicles.length} vehicles · capacity ${station.capacity}`)}>
          <span className="node-mark"><MapPin size={large ? 16 : 13} /></span><span className="node-name">{station.name}</span>
          {vehicles.length > 0 && <span className="node-count">{ready}/{vehicles.length}</span>}
        </button>;
      })}
      {data.vehicles.filter(vehicle => vehicle.has_assignment && ['reserved', 'in_transit'].includes(vehicle.status)).map(vehicle => (
        <div key={`vehicle-${vehicle.id}`} className={`vehicle-map-marker ${vehicle.status === 'in_transit' ? 'vehicle-marker-transit' : 'vehicle-marker-approach'}`} style={{ left: `${vehicle.x * 100}%`, top: `${vehicle.y * 100}%` }} title={vehicle.moving_to ? `${vehicle.name} · ${Math.round(vehicle.progress * 100)}% to ${vehicle.moving_to}` : `${vehicle.name} · awaiting stage confirmation`}>
          <Truck size={12} /><span>{vehicle.name}</span>
        </div>
      ))}
      {data.stations.length === 0 && <div className="map-empty">Add stations to see your network here.</div>}
      <div className="map-legend"><span><i className="legend-dot green" /> Available</span><span><i className="legend-dot amber" /> Reserved / moving</span><span><i className="legend-dot gray" /> No idle vehicle</span></div>
    </div>
  );

  const nav: { name: Page; icon: typeof LayoutDashboard }[] = [
    { name: 'Overview', icon: LayoutDashboard }, { name: 'Transfers', icon: ArrowLeftRight },
    { name: 'Vehicles', icon: Truck }, { name: 'Stations', icon: MapPin }, { name: 'Network', icon: Route },
  ];

  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><div className="brand-icon"><Navigation size={19} /></div><span>fleet<span className="brand-accent">ops</span></span><span className="brand-beta">LIVE</span></div>
      <div className="nav-label">FLEET WORKSPACE</div>
      <nav>{nav.map(item => <button key={item.name} className={`nav-item ${page === item.name ? 'selected' : ''}`} onClick={() => setPage(item.name)}><item.icon size={17} /><span>{item.name}</span>{item.name === 'Transfers' && <span className="nav-count">{active.length}</span>}</button>)}</nav>
      <div className="sidebar-bottom"><div className="fleet-health"><div className="health-top"><span>Fleet readiness</span><span className="health-live"><i /> Live</span></div><div className="health-bar"><i style={{ width: `${data.vehicles.length ? Math.max(12, idleCount / data.vehicles.length * 100) : 0}%` }} /></div><div className="health-note">{idleCount} idle · {movingCount} reserved or moving</div></div></div>
    </aside>
    <main className="main-area">
      <header className="topbar"><div className="crumb"><strong>Fleet workspace</strong><span className="crumb-slash">/</span><span>{page}</span></div><div className="top-actions"><div className={`connection ${online ? 'connected' : ''}`}><i /><span>{online ? 'Live connection' : 'Reconnecting'}</span></div><button className="icon-button theme-toggle" title={dark ? 'Switch to light mode' : 'Switch to dark mode'} aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'} onClick={() => setDark(value => !value)}>{dark ? <Sun size={17} /> : <Moon size={17} />}</button></div></header>
      <div className="content">
        <div className="page-heading"><div><div className="eyebrow"><span className="eyebrow-square"><Navigation size={12} /></span> FLEET OPERATIONS <span className="eyebrow-line" /></div><h1>{page === 'Overview' ? 'Good morning' : page}</h1><p>{page === 'Overview' ? 'Live operations for the stations and vehicles you configure.' : page === 'Transfers' ? 'Assign packages and follow pickup and drop-off ETAs.' : page === 'Vehicles' ? 'Add, configure, reserve, and release vehicles.' : page === 'Stations' ? 'Create stations and clusters, then inspect live availability.' : 'Configure the station distances used for routing and ETAs.'}</p></div><div className="heading-actions"><span className="today-chip"><span /> TODAY, {new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric' }).format(new Date()).toUpperCase()}</span>{page === 'Stations' && <button className="primary-button" onClick={() => { setStationName(''); setClusterName(''); setClusterColor('#438c72'); setStationCapacity('12'); setModal('station'); }}><Plus size={16} /> Add station</button>}{page === 'Vehicles' && <button className="primary-button" disabled={!data.stations.length} onClick={() => openVehicleForm()}><Plus size={16} /> Add vehicle</button>}{page === 'Overview' && data.stations.length > 1 && data.distances.length > 0 && <button className="primary-button" onClick={() => setModal('transfer')}><Plus size={16} /> New transfer</button>}</div></div>

        {page === 'Overview' && <>
          {data.stations.length < 2 || !data.distances.length || !data.vehicles.length ? <section className="setup-guide"><div><span className="demo-kicker">GET STARTED</span><h2>Build your live fleet workspace</h2><p>Add real station and vehicle records, configure the routes, then create a transfer to see live status and ETAs.</p></div><div className="setup-steps"><button onClick={() => setPage('Stations')}><i>1</i><span>{data.stations.length ? `${data.stations.length} stations added` : 'Add stations and clusters'}</span><ArrowRight size={14} /></button><button onClick={() => setPage('Vehicles')}><i>2</i><span>{data.vehicles.length ? `${data.vehicles.length} vehicles added` : 'Add vehicles at stations'}</span><ArrowRight size={14} /></button><button onClick={() => setPage('Network')}><i>3</i><span>{data.distances.length ? `${data.distances.length / 2} routes configured` : 'Configure station routes'}</span><ArrowRight size={14} /></button></div></section> : null}
          <div className="stat-grid"><div className="stat-card"><div className="stat-heading"><span>Active transfers</span><span className="stat-icon mint"><ArrowLeftRight size={17} /></span></div><div className="stat-value">{String(active.length).padStart(2, '0')}<span className="stat-trend">Live</span></div><div className="stat-foot">Across {data.clusters.length} clusters</div></div><div className="stat-card"><div className="stat-heading"><span>Vehicles available</span><span className="stat-icon blue"><Truck size={17} /></span></div><div className="stat-value">{String(idleCount).padStart(2, '0')}<span className="stat-muted"> / {data.vehicles.length}</span></div><div className="stat-foot">Ready for assignment</div></div><div className="stat-card"><div className="stat-heading"><span>On the move</span><span className="stat-icon amber"><Navigation size={17} /></span></div><div className="stat-value">{String(movingCount).padStart(2, '0')}<span className="stat-muted"> vehicles</span></div><div className="stat-foot">Reserved or in transit</div></div><div className="stat-card"><div className="stat-heading"><span>Stations available</span><span className="stat-icon violet"><MapPin size={17} /></span></div><div className="stat-value">{String(data.stations.filter(station => station.available).length).padStart(2, '0')}<span className="stat-muted"> / {data.stations.length}</span></div><div className="stat-foot">Stations with an idle vehicle</div></div></div>
          <div className="overview-grid"><section className="panel map-panel"><div className="panel-header"><div><div className="panel-title">Station and vehicle map <span className="live-pill"><i /> LIVE</span></div><div className="panel-subtitle">Availability and simulated transfer positions</div></div><button className="subtle-button" onClick={() => setPage('Network')}>Network settings <ArrowRight size={14} /></button></div><NetworkMap /></section><section className="panel activity-panel"><div className="panel-header"><div><div className="panel-title">Recent transfers</div><div className="panel-subtitle">Live transfer statuses and ETAs</div></div></div><div className="activity-list">{data.transfers.slice(0, 4).map(transfer => <button className="activity-row" key={transfer.id} onClick={() => { setSelectedId(transfer.id); setPage('Transfers'); }}><div className="activity-icon"><Package size={15} /></div><div className="activity-copy"><strong>{transfer.description}</strong><span>{transfer.pickup_station} <ArrowRight size={10} /> {transfer.dropoff_station}</span></div><div className="activity-time"><span className={`mini-status status-${transfer.status}`}>{transfer.status.replace('_', ' ')}</span><span>{eta(transfer.eta_dropoff, now)}</span></div></button>)}{data.transfers.length === 0 && <div className="empty-state"><Package size={22} /><strong>No transfers yet</strong><span>Create one after setting up stations, routes, and vehicles.</span></div>}</div></section></div>
          <section className="panel transfers-panel"><div className="panel-header"><div><div className="panel-title">Active transfers <span className="count-pill">{active.length}</span></div><div className="panel-subtitle">Pickup and drop-off ETAs update against the current clock</div></div><button className="subtle-button" onClick={() => setPage('Transfers')}>All transfers <ArrowRight size={14} /></button></div><TransferTable rows={active.slice(0, 5)} now={now} onSelect={transfer => { setSelectedId(transfer.id); setPage('Transfers'); }} onAdvance={id => void runAction(() => request(`/api/transfers/${id}/advance`, { method: 'PATCH' }), 'Transfer stage updated')} /></section>
        </>}

        {page === 'Transfers' && <section className="panel full-panel"><div className="panel-header"><div><div className="panel-title">Transfers <span className="count-pill">{data.transfers.length}</span></div><div className="panel-subtitle">Assignments, stages, and live pickup/drop-off ETAs</div></div><div className="table-tools"><label className="search-box"><Search size={15} /><input placeholder="Search transfers" value={search} onChange={event => setSearch(event.target.value)} /></label><button className="primary-button compact" disabled={data.stations.length < 2 || !data.distances.length} onClick={() => setModal('transfer')}><Plus size={15} /> New transfer</button></div></div><TransferTable rows={filteredTransfers} now={now} onSelect={transfer => setSelectedId(transfer.id)} onAdvance={id => void runAction(() => request(`/api/transfers/${id}/advance`, { method: 'PATCH' }), 'Transfer stage updated')} /></section>}

        {page === 'Vehicles' && <><div className="section-toolbar"><div className="section-caption">{idleCount} ready · {data.vehicles.length} vehicles</div></div>{!data.stations.length && <section className="panel empty-panel"><strong>Add a station before adding a vehicle.</strong><button className="primary-button compact" onClick={() => setPage('Stations')}>Go to stations</button></section>}<div className="vehicle-grid">{data.vehicles.map(vehicle => <article className="vehicle-card" key={vehicle.id}><div className="vehicle-top"><div className="vehicle-illustration"><Truck size={20} /></div><span className={`vehicle-state state-${vehicle.status}`}>{vehicle.status.replace('_', ' ')}</span></div><div className="vehicle-name">{vehicle.name}<span>{vehicle.code} · {vehicle.vehicle_type}</span></div><div className="vehicle-location"><MapPin size={13} />{vehicle.station} · {data.stations.find(station => station.id === vehicle.station_id)?.cluster}</div><div className="vehicle-metrics"><div className="battery-row"><div><Battery size={14} /> Battery</div><strong>{vehicle.battery}%</strong></div><div className="battery-track"><i style={{ width: `${vehicle.battery}%` }} /></div><div className="vehicle-bottom"><span>{vehicle.capacity_kg} kg capacity</span><div className="vehicle-actions"><button className="configure-button" disabled={vehicle.status === 'reserved' || vehicle.status === 'in_transit'} onClick={() => openVehicleForm(vehicle)}>Configure</button>{vehicle.status === 'idle' ? <button onClick={() => void runAction(() => request(`/api/vehicles/${vehicle.id}/reserve`, { method: 'PATCH' }), 'Vehicle reserved')}>Reserve</button> : vehicle.status === 'reserved' ? <button className="release-button" onClick={() => void runAction(() => request(`/api/vehicles/${vehicle.id}/release`, { method: 'PATCH' }), 'Vehicle released')}>Release</button> : <span>{vehicle.status.replace('_', ' ')}</span>}</div></div></div></article>)}</div></>}

        {page === 'Stations' && <><div className="station-summary"><div className="summary-card"><span>Stations</span><strong>{data.stations.length}</strong></div><div className="summary-card"><span>Available</span><strong className="text-green">{data.stations.filter(station => station.available).length}</strong></div><div className="summary-card"><span>Clusters</span><strong>{data.clusters.length}</strong></div></div><div className="station-layout"><section className="panel station-map-panel"><div className="panel-header"><div><div className="panel-title">Station availability</div><div className="panel-subtitle">Ready vehicles at each station</div></div></div><NetworkMap large /></section><section className="panel station-list-panel"><div className="panel-header"><div><div className="panel-title">Station directory</div><div className="panel-subtitle">Stations grouped into clusters</div></div></div><div className="station-list">{data.clusters.length ? data.clusters.map(cluster => <div className="cluster-group" key={cluster.id}><div className="cluster-heading"><i style={{ background: cluster.color }} />{cluster.name}<span>{data.stations.filter(station => station.cluster_id === cluster.id).length} stations</span></div>{data.stations.filter(station => station.cluster_id === cluster.id).map(station => <div className="station-row" key={station.id}><div className={`station-status-dot ${station.available ? 'station-ready' : ''}`} /><span>{station.name}</span><span className="station-badge">{data.vehicles.filter(vehicle => vehicle.station_id === station.id && vehicle.status === 'idle').length} ready</span><span className="capacity-text">{station.capacity} cap.</span></div>)}</div>) : <div className="empty-state"><MapPin size={24} /><strong>No stations yet</strong><span>Add your first station and cluster to start building the network.</span></div>}</div></section></div></>}

        {page === 'Network' && <><section className="panel network-page-panel"><div className="panel-header"><div><div className="panel-title">Station route network</div><div className="panel-subtitle">Configure the distance and travel time for station pairs</div></div><button className="primary-button compact" disabled={data.stations.length < 2} onClick={() => { setDistanceFrom(String(data.stations[0]?.id || '')); setDistanceTo(String(data.stations.find(station => station.id !== data.stations[0]?.id)?.id || '')); setDistanceKm(''); setTravelMinutes(''); setModal('distance'); }}><Plus size={15} /> Configure route</button></div><NetworkMap large /></section><section className="panel route-table-panel"><div className="panel-header"><div><div className="panel-title">Configured routes <span className="count-pill">{data.distances.length / 2}</span></div><div className="panel-subtitle">Route time powers vehicle assignment and live ETA</div></div></div><div className="route-list">{data.distances.filter(route => route.from_station_id < route.to_station_id).map(route => <div className="route-row" key={route.id}><div className="route-end"><span className="route-point" />{route.from_station}</div><div className="route-connector"><i />{route.distance_km} km</div><div className="route-end"><span className="route-point end" />{route.to_station}</div><span className="route-duration"><Clock3 size={13} />{route.travel_minutes} min</span></div>)}{data.distances.length === 0 && <div className="empty-state"><Route size={24} /><strong>No routes configured</strong><span>Add at least two stations and configure a route before assigning transfers.</span></div>}</div></section></>}

        {selected && page === 'Transfers' && <div className="detail-drawer-backdrop" onClick={() => setSelectedId(null)}><aside className="detail-drawer" onClick={event => event.stopPropagation()}><div className="drawer-head"><div><span className="eyebrow">TRANSFER</span><h2>{selected.reference}</h2></div><button className="icon-button" onClick={() => setSelectedId(null)}><X size={17} /></button></div><div className="drawer-status"><span className={`mini-status status-${selected.status}`}>{selected.status.replace('_', ' ')}</span><span>Live status</span></div><div className="drawer-package"><div className="package-icon"><Package size={20} /></div><div><strong>{selected.description}</strong><span>{selected.weight_kg} kg</span></div></div><div className="drawer-route"><div className="route-stop"><i className="stop-dot pickup" /><div><span>PICKUP</span><strong>{selected.pickup_station}</strong><small>ETA {eta(selected.eta_pickup, now)}</small></div></div><div className="route-stop"><i className="stop-dot drop" /><div><span>DROP-OFF</span><strong>{selected.dropoff_station}</strong><small>ETA {eta(selected.eta_dropoff, now)}</small></div></div></div><div className="drawer-vehicle"><span>ASSIGNED VEHICLE</span><strong><Truck size={15} />{selected.vehicle || 'Unassigned'}</strong></div><div className="drawer-hint">Advance each dispatch stage when the pickup or delivery is confirmed. ETAs and simulated map positions update from the current timestamp.</div><button className="primary-button drawer-action" disabled={selected.status === 'delivered'} onClick={() => void runAction(() => request(`/api/transfers/${selected.id}/advance`, { method: 'PATCH' }), 'Transfer stage updated')}><Check size={15} />{selected.status === 'assigned' ? 'Confirm pickup' : selected.status === 'pickup' ? 'Start delivery' : selected.status === 'in_transit' ? 'Mark delivered' : 'Transfer complete'}</button></aside></div>}
      </div>
    </main>

    {modal && <div className="modal-backdrop" onClick={() => !busy && setModal('')}><div className="modal" onClick={event => event.stopPropagation()}><div className="modal-head"><div><span className="eyebrow">FLEET WORKSPACE</span><h2>{modal === 'station' ? 'Add a station' : modal === 'transfer' ? 'Create a transfer' : modal === 'vehicle' ? (editingVehicle ? 'Configure vehicle' : 'Add a vehicle') : 'Configure station route'}</h2><p>{modal === 'station' ? 'Add a station to a new or existing cluster, then configure its routes.' : modal === 'transfer' ? 'Choose stations and package weight. An idle vehicle and route are required.' : modal === 'vehicle' ? (editingVehicle ? 'Update vehicle details and station.' : 'Add a vehicle at one of your stations.') : 'Set the bidirectional distance and travel time used by ETA calculations.'}</p></div><button className="icon-button" onClick={() => setModal('')}><X size={17} /></button></div>

      {modal === 'station' && <div className="form-body"><label className="field-label">STATION NAME<input value={stationName} onChange={event => setStationName(event.target.value)} placeholder="Station name" /></label><div className="field-row"><label className="field-label">CLUSTER NAME<input list="cluster-options" value={clusterName} onChange={event => { setClusterName(event.target.value); const existing = data.clusters.find(cluster => cluster.name === event.target.value); if (existing) setClusterColor(existing.color); }} placeholder="Existing or new cluster" /><datalist id="cluster-options">{data.clusters.map(cluster => <option key={cluster.id} value={cluster.name} />)}</datalist></label><label className="field-label">CLUSTER COLOR<input type="color" value={clusterColor} onChange={event => setClusterColor(event.target.value)} /></label></div><label className="field-label">STATION CAPACITY<input type="number" min="1" value={stationCapacity} onChange={event => setStationCapacity(event.target.value)} /></label><div className="modal-actions"><button className="cancel-button" onClick={() => setModal('')}>Cancel</button><button className="primary-button" disabled={busy || stationName.trim().length < 2 || clusterName.trim().length < 2 || Number(stationCapacity) < 1} onClick={() => void runAction(() => request('/api/stations', { method: 'POST', body: JSON.stringify({ name: stationName, cluster_name: clusterName, cluster_color: clusterColor, capacity: Number(stationCapacity) }) }), 'Station added')} >{busy ? 'Saving…' : 'Add station'}<ArrowRight size={15} /></button></div></div>}

      {modal === 'vehicle' && <div className="form-body"><div className="field-row"><label className="field-label">VEHICLE NAME<input value={vehicleName} onChange={event => setVehicleName(event.target.value)} placeholder="Vehicle name" /></label><label className="field-label">FLEET CODE<input value={vehicleCode} onChange={event => setVehicleCode(event.target.value)} placeholder="Unique fleet code" /></label></div><label className="field-label">STATION<select value={vehicleStation} onChange={event => setVehicleStation(event.target.value)}>{data.stations.map(station => <option key={station.id} value={station.id}>{station.name} · {station.cluster}</option>)}</select></label><div className="field-row"><label className="field-label">VEHICLE TYPE<select value={vehicleType} onChange={event => setVehicleType(event.target.value)}><option>Utility cart</option><option>Cargo rover</option><option>Passenger shuttle</option></select></label><label className="field-label">CAPACITY (KG)<input type="number" min="1" value={vehicleCapacity} onChange={event => setVehicleCapacity(event.target.value)} /></label></div><div className="field-row"><label className="field-label">BATTERY (%)<input type="number" min="0" max="100" value={vehicleBattery} onChange={event => setVehicleBattery(event.target.value)} /></label><label className="field-label">AVAILABILITY<select value={vehicleStatus} onChange={event => setVehicleStatus(event.target.value)}><option value="idle">Ready for dispatch</option><option value="maintenance">Maintenance</option></select></label></div><div className="modal-actions"><button className="cancel-button" onClick={() => setModal('')}>Cancel</button><button className="primary-button" disabled={busy || !vehicleStation || vehicleName.trim().length < 2 || vehicleCode.trim().length < 2 || Number(vehicleCapacity) < 1} onClick={() => void runAction(() => request(editingVehicle ? `/api/vehicles/${editingVehicle.id}` : '/api/vehicles', { method: editingVehicle ? 'PATCH' : 'POST', body: JSON.stringify({ name: vehicleName, code: vehicleCode, station_id: Number(vehicleStation), capacity_kg: Number(vehicleCapacity), vehicle_type: vehicleType, battery: Number(vehicleBattery), status: vehicleStatus }) }), editingVehicle ? 'Vehicle configuration saved' : 'Vehicle added')} >{busy ? 'Saving…' : editingVehicle ? 'Save changes' : 'Add vehicle'}<ArrowRight size={15} /></button></div></div>}

      {modal === 'transfer' && <div className="form-body"><label className="field-label">PACKAGE / JOB DESCRIPTION<input value={description} onChange={event => setDescription(event.target.value)} placeholder="Package or job description" /></label><div className="field-row"><label className="field-label">PICKUP STATION<select value={pickupId} onChange={event => setPickupId(event.target.value)}>{data.stations.map(station => <option key={station.id} value={station.id}>{station.name} · {station.cluster}</option>)}</select></label><label className="field-label">DROP-OFF STATION<select value={dropoffId} onChange={event => setDropoffId(event.target.value)}>{data.stations.map(station => <option key={station.id} value={station.id}>{station.name} · {station.cluster}</option>)}</select></label></div><label className="field-label">PACKAGE WEIGHT (KG)<input type="number" min="1" value={weight} onChange={event => setWeight(event.target.value)} /></label><div className="smart-assignment"><div className="smart-icon"><ShieldCheck size={16} /></div><div><strong>Automatic vehicle assignment</strong><span>Requires a configured pickup/drop-off route and an idle vehicle with enough capacity.</span></div></div><div className="modal-actions"><button className="cancel-button" onClick={() => setModal('')}>Cancel</button><button className="primary-button" disabled={busy || !description.trim() || !pickupId || !dropoffId || pickupId === dropoffId || Number(weight) < 1} onClick={() => void createTransfer()}>{busy ? 'Assigning…' : 'Assign transfer'}<ArrowRight size={15} /></button></div></div>}

      {modal === 'distance' && <div className="form-body"><div className="field-row"><label className="field-label">FROM STATION<select value={distanceFrom} onChange={event => setDistanceFrom(event.target.value)}>{data.stations.map(station => <option key={station.id} value={station.id}>{station.name}</option>)}</select></label><label className="field-label">TO STATION<select value={distanceTo} onChange={event => setDistanceTo(event.target.value)}>{data.stations.map(station => <option key={station.id} value={station.id}>{station.name}</option>)}</select></label></div><div className="field-row"><label className="field-label">DISTANCE (KM)<input type="number" min="0.1" step="0.1" value={distanceKm} onChange={event => setDistanceKm(event.target.value)} /></label><label className="field-label">TRAVEL TIME (MINUTES)<input type="number" min="1" value={travelMinutes} onChange={event => setTravelMinutes(event.target.value)} /></label></div><div className="smart-assignment"><div className="smart-icon"><Route size={16} /></div><div><strong>Bidirectional route</strong><span>This distance and duration apply in both directions.</span></div></div><div className="modal-actions"><button className="cancel-button" onClick={() => setModal('')}>Cancel</button><button className="primary-button" disabled={busy || !distanceFrom || !distanceTo || distanceFrom === distanceTo || Number(distanceKm) <= 0 || Number(travelMinutes) < 1} onClick={() => void runAction(() => request('/api/distances', { method: 'PUT', body: JSON.stringify({ from_station_id: Number(distanceFrom), to_station_id: Number(distanceTo), distance_km: Number(distanceKm), travel_minutes: Number(travelMinutes) }) }), 'Route updated')} >Save route<Check size={15} /></button></div></div>}
    </div></div>}
    {toast && <div className="toast"><span><Check size={14} /></span>{toast}<button onClick={() => setToast('')}><X size={14} /></button></div>}
  </div>;
}

function TransferTable({ rows, now, onSelect, onAdvance }: { rows: Transfer[]; now: number; onSelect: (transfer: Transfer) => void; onAdvance: (id: number) => void }) {
  return <div className="table-scroll"><table><thead><tr><th>TRANSFER</th><th>ROUTE</th><th>VEHICLE</th><th>STATUS</th><th>PICKUP ETA</th><th>DROP-OFF ETA</th><th /></tr></thead><tbody>{rows.map(transfer => <tr key={transfer.id} onClick={() => onSelect(transfer)}><td><div className="transfer-ref"><div className="transfer-glyph"><Package size={14} /></div><div><strong>{transfer.reference}</strong><span>{transfer.description}</span></div></div></td><td><div className="table-route"><span>{transfer.pickup_station}</span><ArrowRight size={12} /><span>{transfer.dropoff_station}</span></div></td><td>{transfer.vehicle || <span className="unassigned">Unassigned</span>}</td><td><span className={`status-pill status-${transfer.status}`}><i />{transfer.status.replace('_', ' ')}</span></td><td><span className="eta-cell"><Clock3 size={12} />{eta(transfer.eta_pickup, now)}</span></td><td><span className="eta-cell"><Clock3 size={12} />{eta(transfer.eta_dropoff, now)}</span></td><td>{!['delivered', 'cancelled'].includes(transfer.status) && <button className="row-action" title="Advance transfer" onClick={event => { event.stopPropagation(); onAdvance(transfer.id); }}><ArrowRight size={15} /></button>}</td></tr>)}</tbody></table>{rows.length === 0 && <div className="empty-state"><Package size={24} /><strong>No transfers yet</strong><span>Set up stations, routes, and vehicles, then create a transfer.</span></div>}</div>;
}

createRoot(document.getElementById('root')!).render(<App />);
