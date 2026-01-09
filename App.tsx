
import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { DeliveryStop, Coordinate, Customer, SavedRoute } from './types';
import { parseAddress, analyzeRoute, bulkParseAddresses } from './services/geminiService';
import { optimizeRoute, calculateDistance } from './utils/optimizer';
import RouteMap from './components/RouteMap';
import { Language, translations } from './translations';

const DEFAULT_LOCATION: Coordinate = { lat: 34.0522, lng: -118.2437 };
const STORAGE_KEY = 'swiftroute_v2_state';
const AUTH_KEY = 'swiftroute_auth';
const DEFAULT_DEPOT_START_TIME = "09:00 AM";

const App: React.FC = () => {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [dispatcherName, setDispatcherName] = useState('');
  const [dispatcherId, setDispatcherId] = useState('');
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  
  const [activeTab, setActiveTab] = useState<'manifest' | 'directory' | 'routes'>('manifest');
  const [lang, setLang] = useState<Language>('en');
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const t = translations[lang];
  
  const [stops, setStops] = useState<DeliveryStop[]>([]);
  const [savedCustomers, setSavedCustomers] = useState<Customer[]>([]);
  const [savedRoutes, setSavedRoutes] = useState<SavedRoute[]>([]);
  const [aiSummary, setAiSummary] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [isAutoRefreshEnabled, setIsAutoRefreshEnabled] = useState(false);
  const [useSystemTime, setUseSystemTime] = useState(false);
  const [depotLocation, setDepotLocation] = useState<Coordinate>(DEFAULT_LOCATION);
  const [isLocating, setIsLocating] = useState(false);
  const [showLangMenu, setShowLangMenu] = useState(false);
  const [showProfileMenu, setShowProfileMenu] = useState(false);
  
  const [isSaveModalOpen, setIsSaveModalOpen] = useState(false);
  const [newRouteName, setNewRouteName] = useState('');

  const langMenuRef = useRef<HTMLDivElement>(null);
  const profileMenuRef = useRef<HTMLDivElement>(null);

  const isIOS = useMemo(() => {
    if (typeof window === 'undefined') return false;
    return [
      'iPad Simulator', 'iPhone Simulator', 'iPod Simulator', 'iPad', 'iPhone', 'iPod'
    ].includes(navigator.platform)
    || (navigator.userAgent.includes("Mac") && "ontouchend" in document);
  }, []);

  const getCurrentTimeFormatted = () => {
    const now = new Date();
    let hours = now.getHours();
    const minutes = now.getMinutes().toString().padStart(2, '0');
    const ampm = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12;
    hours = hours ? hours : 12;
    return `${hours}:${minutes} ${ampm}`;
  };

  useEffect(() => {
    const auth = localStorage.getItem(AUTH_KEY);
    if (auth) {
      const parsedAuth = JSON.parse(auth);
      setDispatcherName(parsedAuth.name);
      setDispatcherId(parsedAuth.id);
      setIsLoggedIn(true);
    }

    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        setStops(parsed.stops || []);
        setSavedCustomers(parsed.savedCustomers || []);
        setSavedRoutes(parsed.savedRoutes || []);
        setAiSummary(parsed.aiSummary || null);
        if (parsed.lastUpdated) setLastUpdated(new Date(parsed.lastUpdated));
        if (parsed.depotLocation) setDepotLocation(parsed.depotLocation);
        if (parsed.lang) setLang(parsed.lang as Language);
        if (parsed.theme) setTheme(parsed.theme as 'light' | 'dark');
        if (parsed.useSystemTime !== undefined) setUseSystemTime(parsed.useSystemTime);
      } catch (e) {
        console.error("Failed to parse saved state", e);
      }
    }

    if (window.innerWidth < 1024) {
      setIsSidebarOpen(false);
    }
  }, []);

  // Update document class when theme changes
  useEffect(() => {
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [theme]);

  const [selectedStopId, setSelectedStopId] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [priority, setPriority] = useState<'low' | 'medium' | 'high'>('medium');
  const [isLoading, setIsLoading] = useState(false);
  const [isOptimizing, setIsOptimizing] = useState(false);
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);

  useEffect(() => {
    const stateToSave = JSON.stringify({ 
      stops, 
      savedCustomers, 
      savedRoutes,
      aiSummary,
      depotLocation,
      lang,
      theme,
      useSystemTime,
      lastUpdated: lastUpdated?.toISOString()
    });
    localStorage.setItem(STORAGE_KEY, stateToSave);
  }, [stops, savedCustomers, savedRoutes, aiSummary, lastUpdated, depotLocation, lang, theme, useSystemTime]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (langMenuRef.current && !langMenuRef.current.contains(event.target as Node)) setShowLangMenu(false);
      if (profileMenuRef.current && !profileMenuRef.current.contains(event.target as Node)) setShowProfileMenu(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const routeStats = useMemo(() => {
    if (stops.length === 0) return { distance: 0, duration: "0h 0m" };
    let totalDist = 0;
    let current = depotLocation;
    stops.forEach(stop => {
      totalDist += calculateDistance(current, stop.coords) * 111;
      current = stop.coords;
    });
    const lastStop = stops[stops.length - 1];
    if (lastStop.estimatedTime) {
      try {
        const parseTime = (timeStr: string) => {
          const [time, modifier] = timeStr.split(' ');
          let [hours, minutes] = time.split(':').map(Number);
          if (modifier === 'PM' && hours < 12) hours += 12;
          if (modifier === 'AM' && hours === 12) hours = 0;
          return hours * 60 + minutes;
        };
        const startTimeStr = useSystemTime && lastUpdated ? getCurrentTimeFormatted() : DEFAULT_DEPOT_START_TIME;
        const startMinutes = parseTime(startTimeStr);
        const endMinutes = parseTime(lastStop.estimatedTime);
        const diff = endMinutes - startMinutes;
        const h = Math.floor(diff / 60);
        const m = diff % 60;
        return { distance: totalDist, duration: `${h}h ${m}m` };
      } catch (e) {
        return { distance: totalDist, duration: "..." };
      }
    }
    return { distance: totalDist, duration: "..." };
  }, [stops, depotLocation, useSystemTime, lastUpdated]);

  const runOptimization = useCallback(async (manualStops?: DeliveryStop[], manualDepot?: Coordinate) => {
    const targetStops = manualStops || stops;
    const targetDepot = manualDepot || depotLocation;
    if (targetStops.length === 0) return;
    setIsOptimizing(true);
    if (!manualStops) setSelectedStopId(null);
    const orderedStops = manualStops ? manualStops : optimizeRoute(targetDepot, targetStops);
    const startTime = useSystemTime ? getCurrentTimeFormatted() : DEFAULT_DEPOT_START_TIME;
    try {
      const result = await analyzeRoute(orderedStops, lang, startTime);
      const stopsWithInsights = orderedStops.map(stop => {
        const insight = result.etas.find(e => e.id === stop.id);
        return { ...stop, estimatedTime: insight?.eta, trafficCondition: insight?.traffic };
      });
      setStops(stopsWithInsights);
      setAiSummary(result.summary);
      setLastUpdated(new Date());
    } catch (error) {
      setStops(orderedStops);
    } finally {
      setIsOptimizing(false);
    }
  }, [stops, depotLocation, lang, useSystemTime]);

  const handleAddStop = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!input.trim()) return;
    setIsLoading(true);
    try {
      const parsed = await parseAddress(input);
      const newStop: DeliveryStop = {
        id: crypto.randomUUID(),
        address: parsed.address,
        customerName: parsed.customerName,
        priority: priority,
        coords: parsed.coords
      };
      const updatedStops = [...stops, newStop];
      setStops(updatedStops);
      setInput('');
      setAiSummary(null);
      runOptimization(updatedStops);
    } catch (error) {
      console.error(error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSaveCurrentRoute = () => {
    if (!newRouteName.trim() || stops.length === 0) return;
    const newRoute: SavedRoute = {
      id: crypto.randomUUID(),
      name: newRouteName.trim(),
      stops: [...stops],
      date: new Date().toLocaleDateString(lang === 'de' ? 'de-DE' : lang === 'es' ? 'es-ES' : 'en-US'),
      totalDistance: routeStats.distance
    };
    setSavedRoutes(prev => [newRoute, ...prev]);
    setNewRouteName('');
    setIsSaveModalOpen(false);
  };

  const loadSavedRoute = (route: SavedRoute) => {
    setStops(route.stops);
    setActiveTab('manifest');
    runOptimization(route.stops);
  };

  const deleteSavedRoute = (id: string) => {
    if (confirm(t.delete + "?")) {
      setSavedRoutes(prev => prev.filter(r => r.id !== id));
    }
  };

  const handleStartRoute = () => {
    if (stops.length === 0) return;
    const origin = `${depotLocation.lat},${depotLocation.lng}`;
    const destination = `${stops[stops.length - 1].coords.lat},${stops[stops.length - 1].coords.lng}`;
    const waypoints = stops.slice(0, -1).map(s => `${s.coords.lat},${s.coords.lng}`).join('|');
    let url = isIOS 
      ? `maps://?saddr=${origin}&daddr=${destination}&${stops.slice(0, -1).map(s => `daddr=${s.coords.lat},${s.coords.lng}`).join('&')}`
      : `https://www.google.com/maps/dir/?api=1&origin=${origin}&destination=${destination}&waypoints=${waypoints}&travelmode=driving`;
    window.open(url, '_blank');
  };

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    if (!dispatcherName.trim()) return;
    localStorage.setItem(AUTH_KEY, JSON.stringify({ name: dispatcherName, id: dispatcherId || '#42' }));
    setIsLoggedIn(true);
  };

  const handleLogout = () => {
    localStorage.removeItem(AUTH_KEY);
    setIsLoggedIn(false);
  };

  const handleDrop = (index: number) => {
    if (draggedIndex === null || draggedIndex === index) return;
    const updatedStops = [...stops];
    const [movedItem] = updatedStops.splice(draggedIndex, 1);
    updatedStops.splice(index, 0, movedItem);
    setStops(updatedStops);
    setDraggedIndex(null);
    runOptimization(updatedStops);
  };

  const toggleTheme = () => {
    setTheme(prev => prev === 'light' ? 'dark' : 'light');
  };

  if (!isLoggedIn) {
    return (
      <div className="h-screen w-screen bg-slate-900 flex items-center justify-center p-6 relative overflow-hidden pt-safe pb-safe">
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-blue-600/10 rounded-full blur-[120px] animate-pulse"></div>
        <div className="w-full max-w-md bg-white rounded-[2.5rem] shadow-2xl overflow-hidden relative z-10 animate-in zoom-in-95 duration-500">
          <div className="p-10 bg-slate-900 text-white text-center">
            <div className="w-20 h-20 bg-blue-600 rounded-3xl mx-auto mb-8 flex items-center justify-center shadow-2xl shadow-blue-500/40">
              <svg className="w-12 h-12 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
            </div>
            <h1 className="text-3xl font-black uppercase tracking-tight mb-3">{t.login_title}</h1>
            <p className="text-slate-400 text-sm font-medium leading-relaxed opacity-80">{t.login_subtitle}</p>
          </div>
          <form onSubmit={handleLogin} className="p-10 space-y-8">
            <div className="space-y-6">
              <div>
                <label className="text-xs font-bold text-slate-400 uppercase tracking-widest block mb-3">{t.login_name}</label>
                <input autoFocus required value={dispatcherName} onChange={(e) => setDispatcherName(e.target.value)} className="w-full px-5 py-4 bg-slate-50 border border-slate-200 rounded-2xl text-base focus:ring-4 focus:ring-blue-500/10 focus:border-blue-600 outline-none transition-all shadow-inner" />
              </div>
              <div>
                <label className="text-xs font-bold text-slate-400 uppercase tracking-widest block mb-3">{t.login_id}</label>
                <input value={dispatcherId} onChange={(e) => setDispatcherId(e.target.value)} placeholder="#42" className="w-full px-5 py-4 bg-slate-50 border border-slate-200 rounded-2xl text-base focus:ring-4 focus:ring-blue-500/10 focus:border-blue-600 outline-none transition-all shadow-inner" />
              </div>
            </div>
            <button type="submit" className="w-full py-5 bg-blue-600 text-white rounded-2xl font-black uppercase tracking-widest text-sm shadow-xl hover:bg-blue-700 active:scale-[0.97] transition-all flex items-center justify-center gap-4">
              {t.login_button}
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M14 5l7 7m0 0l-7 7m7-7H3" /></svg>
            </button>
            <div className="pt-4 flex justify-center gap-8">
              {['en', 'es', 'de'].map(l => (
                <button key={l} type="button" onClick={() => setLang(l as Language)} className={`text-[11px] font-black uppercase tracking-widest ${lang === l ? 'text-blue-600 border-b-2 border-blue-600' : 'text-slate-400'}`}>{l.toUpperCase()}</button>
              ))}
            </div>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 animate-in fade-in duration-500 overflow-hidden pt-safe pb-safe">
      <aside className={`fixed lg:static inset-y-0 left-0 w-[85vw] max-w-[380px] lg:w-96 flex flex-col border-r border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-2xl lg:shadow-none z-40 transition-transform duration-300 ease-in-out transform ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}`}>
        <div className="p-8 pb-6 border-b border-slate-100 dark:border-slate-800 bg-slate-900 text-white pt-safe">
          <div className="flex items-center justify-between">
            <h1 className="text-2xl font-black flex items-center gap-3">
              <svg className="w-8 h-8 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
              {t.app_name}
            </h1>
            <button onClick={() => setIsSidebarOpen(false)} className="lg:hidden p-2 hover:bg-white/10 rounded-xl transition-colors">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
          </div>
          <p className="text-blue-400/60 text-[10px] mt-3 uppercase tracking-[0.3em] font-black">{t.logistics_center}</p>
        </div>

        <div className="flex border-b border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 p-1">
          <button onClick={() => setActiveTab('manifest')} className={`flex-1 py-4 text-[10px] font-black uppercase tracking-widest rounded-xl transition-all ${activeTab === 'manifest' ? 'bg-white dark:bg-slate-800 shadow-sm text-blue-600 dark:text-blue-400' : 'text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300'}`}>{t.route_manifest}</button>
          <button onClick={() => setActiveTab('directory')} className={`flex-1 py-4 text-[10px] font-black uppercase tracking-widest rounded-xl transition-all ${activeTab === 'directory' ? 'bg-white dark:bg-slate-800 shadow-sm text-blue-600 dark:text-blue-400' : 'text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300'}`}>{t.customer_db}</button>
          <button onClick={() => setActiveTab('routes')} className={`flex-1 py-4 text-[10px] font-black uppercase tracking-widest rounded-xl transition-all ${activeTab === 'routes' ? 'bg-white dark:bg-slate-800 shadow-sm text-blue-600 dark:text-blue-400' : 'text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300'}`}>{t.saved_routes_tab}</button>
        </div>

        {activeTab === 'manifest' && (
          <div className="p-6 bg-white dark:bg-slate-900 border-b border-slate-100 dark:border-slate-800">
            <form onSubmit={handleAddStop} className="space-y-4">
              <div className="relative">
                <div className="flex items-center justify-between mb-2 px-1">
                  <label className="text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest">{t.search_placeholder}</label>
                  <button type="button" onClick={() => { if(!navigator.geolocation) return; setIsLocating(true); navigator.geolocation.getCurrentPosition(p => { setDepotLocation({lat:p.coords.latitude, lng:p.coords.longitude}); setIsLocating(false); if(stops.length) runOptimization(stops, {lat:p.coords.latitude, lng:p.coords.longitude}); }, () => setIsLocating(false)); }} disabled={isLocating} className="text-[10px] font-black text-blue-600 dark:text-blue-400 flex items-center gap-1.5 uppercase active:scale-95">
                    <svg className={`w-3.5 h-3.5 ${isLocating ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" /></svg>
                    {isLocating ? '...' : t.start_my_location}
                  </button>
                </div>
                <input type="text" value={input} onChange={(e) => setInput(e.target.value)} placeholder="e.g. 123 Main St" className="w-full px-5 py-4 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-2xl text-sm focus:ring-4 focus:ring-blue-500/10 focus:border-blue-500 outline-none transition-all shadow-inner text-slate-900 dark:text-slate-100" disabled={isLoading} />
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <select value={priority} onChange={(e) => setPriority(e.target.value as any)} className="flex-1 px-4 py-3 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl text-[11px] font-black uppercase tracking-widest text-slate-700 dark:text-slate-300 outline-none">
                  <option value="low">{t.priority_low}</option>
                  <option value="medium">{t.priority_medium}</option>
                  <option value="high">{t.priority_high}</option>
                </select>
                <button type="submit" disabled={isLoading || !input.trim()} className="bg-blue-600 dark:bg-blue-500 text-white px-6 py-3 rounded-xl text-xs font-black uppercase tracking-widest transition-all shadow-lg active:scale-95">
                  {isLoading ? '...' : t.add}
                </button>
              </div>
            </form>
          </div>
        )}

        <div className="flex-1 overflow-y-auto custom-scrollbar p-6 space-y-4">
          {activeTab === 'manifest' ? (
            <>
              <div className="flex items-center justify-between mb-2">
                <h2 className="text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest">{t.active_manifest} ({stops.length})</h2>
                <div className="flex items-center gap-4">
                  <button onClick={() => setIsSaveModalOpen(true)} disabled={stops.length === 0} className="text-[10px] font-black text-blue-600 dark:text-blue-400 uppercase active:scale-95 disabled:opacity-30">{t.save_route_btn}</button>
                  <button onClick={() => { if(confirm(t.flush_route + "?")) setStops([]); }} className="text-[10px] font-black text-red-500 dark:text-red-400 uppercase active:scale-95">{t.flush_route}</button>
                </div>
              </div>
              {stops.length === 0 ? (
                <div className="text-center py-20 opacity-30">
                  <svg className="w-16 h-16 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" /></svg>
                  <p className="text-xs font-black uppercase tracking-widest">{t.empty_payload}</p>
                </div>
              ) : (
                stops.map((stop, index) => (
                  <div key={stop.id} draggable onDragStart={() => setDraggedIndex(index)} onDragOver={(e) => e.preventDefault()} onDrop={() => handleDrop(index)} onClick={() => setSelectedStopId(stop.id)} className={`p-4 bg-white dark:bg-slate-800 border-2 rounded-2xl shadow-sm transition-all cursor-pointer active:scale-[0.98] ${selectedStopId === stop.id ? 'border-blue-500 ring-4 ring-blue-50 dark:ring-blue-900/30' : 'border-slate-100 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600'}`}>
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-3 mb-1">
                          <span className={`flex-shrink-0 w-6 h-6 flex items-center justify-center rounded-lg text-[10px] font-black ${selectedStopId === stop.id ? 'bg-blue-600 text-white' : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300'}`}>{index + 1}</span>
                          <h3 className="text-sm font-black text-slate-800 dark:text-slate-100 truncate">{stop.customerName}</h3>
                        </div>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate pl-9">{stop.address}</p>
                        {stop.estimatedTime && (
                          <div className="mt-3 pl-9 flex items-center gap-3">
                            <span className="text-[10px] font-black text-slate-700 dark:text-slate-300 bg-slate-100 dark:bg-slate-700 px-2 py-1 rounded-md uppercase tracking-tighter">{t.eta} {stop.estimatedTime}</span>
                            <div className={`w-2 h-2 rounded-full ${stop.trafficCondition === 'heavy' ? 'bg-red-500' : stop.trafficCondition === 'moderate' ? 'bg-amber-500' : 'bg-emerald-500'}`} />
                          </div>
                        )}
                      </div>
                      <button onClick={(e) => { e.stopPropagation(); setStops(prev => prev.filter(s => s.id !== stop.id)); }} className="text-slate-300 dark:text-slate-600 hover:text-red-500 dark:hover:text-red-400 p-1 active:scale-125 transition-transform"><svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" /></svg></button>
                    </div>
                  </div>
                ))
              )}
            </>
          ) : activeTab === 'directory' ? (
            <>
              <div className="flex items-center justify-between mb-2">
                <h2 className="text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest">{t.customer_db}</h2>
              </div>
              {savedCustomers.map(customer => (
                <div key={customer.id} className="p-4 bg-white dark:bg-slate-800 border-2 border-slate-100 dark:border-slate-700 rounded-2xl flex justify-between items-center shadow-sm">
                  <div className="min-w-0 flex-1">
                    <h3 className="text-sm font-black text-slate-800 dark:text-slate-100 truncate">{customer.name}</h3>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">{customer.address}</p>
                  </div>
                  <button onClick={() => { 
                    const newStop: DeliveryStop = { id: crypto.randomUUID(), customerName: customer.name, address: customer.address, coords: customer.coords, priority: 'medium' };
                    const updatedStops = [...stops, newStop];
                    setStops(updatedStops); 
                    setActiveTab('manifest'); 
                    runOptimization(updatedStops);
                  }} className="ml-4 px-4 py-2 bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 text-[10px] font-black uppercase rounded-lg active:scale-95">{t.add}</button>
                </div>
              ))}
            </>
          ) : (
            <>
              <div className="flex items-center justify-between mb-2">
                <h2 className="text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest">{t.saved_routes_tab}</h2>
              </div>
              {savedRoutes.length === 0 ? (
                <div className="text-center py-20 opacity-30 italic text-xs font-bold uppercase tracking-widest dark:text-slate-400">{t.no_saved_routes}</div>
              ) : (
                savedRoutes.map(route => (
                  <div key={route.id} className="p-5 bg-white dark:bg-slate-800 border-2 border-slate-100 dark:border-slate-700 rounded-2xl shadow-sm space-y-3 group hover:border-blue-200 dark:hover:border-blue-800 transition-colors">
                    <div className="flex justify-between items-start">
                      <div className="min-w-0">
                        <h3 className="text-sm font-black text-slate-800 dark:text-slate-100 truncate">{route.name}</h3>
                        <p className="text-[10px] text-slate-400 dark:text-slate-500 font-bold uppercase tracking-widest mt-0.5">{route.date} • {route.stops.length} {t.targets}</p>
                      </div>
                      <button onClick={() => deleteSavedRoute(route.id)} className="text-slate-300 dark:text-slate-600 hover:text-red-500 dark:hover:text-red-400 transition-colors"><svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg></button>
                    </div>
                    <button onClick={() => loadSavedRoute(route)} className="w-full py-2.5 bg-slate-900 dark:bg-slate-950 text-white text-[10px] font-black uppercase rounded-xl active:scale-95 transition-all">{t.load}</button>
                  </div>
                ))
              )}
            </>
          )}
        </div>

        {activeTab === 'manifest' && (
          <div className="p-6 border-t border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 space-y-4 pb-safe">
            <div className="space-y-3">
              <div className="flex items-center justify-between px-1">
                 <span className="text-[10px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-widest">{t.auto_refresh}</span>
                 <button onClick={() => setIsAutoRefreshEnabled(!isAutoRefreshEnabled)} className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${isAutoRefreshEnabled ? 'bg-blue-600' : 'bg-slate-300 dark:bg-slate-700'}`}><span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${isAutoRefreshEnabled ? 'translate-x-6' : 'translate-x-1'}`} /></button>
              </div>
              <div className="flex items-center justify-between px-1">
                 <span className="text-[10px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-widest">{t.use_current_time}</span>
                 <button onClick={() => setUseSystemTime(!useSystemTime)} className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${useSystemTime ? 'bg-indigo-600' : 'bg-slate-300 dark:bg-slate-700'}`}><span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${useSystemTime ? 'translate-x-6' : 'translate-x-1'}`} /></button>
              </div>
            </div>
            
            <button onClick={handleStartRoute} disabled={stops.length < 1} className="w-full h-16 bg-emerald-600 dark:bg-emerald-700 text-white rounded-[1.25rem] font-black uppercase tracking-[0.2em] text-sm shadow-2xl shadow-emerald-200 dark:shadow-none active:scale-[0.96] transition-all flex items-center justify-center gap-3">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
              {t.start_now}
            </button>
            <button onClick={() => runOptimization()} disabled={stops.length < 1 || isOptimizing} className="w-full h-12 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 border-2 border-slate-200 dark:border-slate-700 rounded-[1rem] font-black uppercase tracking-widest text-[10px] active:scale-[0.98] flex items-center justify-center gap-2">
              {isOptimizing ? <div className="w-4 h-4 border-2 border-slate-300 border-t-slate-800 rounded-full animate-spin" /> : t.manual_refresh}
            </button>
          </div>
        )}
      </aside>

      {/* Main Content */}
      <div className="flex-1 flex flex-col relative h-full">
        <header className="h-20 bg-white/80 dark:bg-slate-900/80 backdrop-blur-xl border-b border-slate-100 dark:border-slate-800 flex items-center justify-between px-6 lg:px-10 z-20 shadow-sm pt-safe">
          <div className="flex items-center gap-5">
            <button onClick={() => setIsSidebarOpen(true)} className="lg:hidden p-3 bg-slate-900 dark:bg-slate-800 text-white rounded-2xl active:scale-90 shadow-lg">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M4 6h16M4 12h16M4 18h16" /></svg>
            </button>
            <div className="hidden sm:flex flex-col">
              <span className="text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-1">{t.system_health}</span>
              <div className="flex items-center gap-2">
                <div className={`w-2.5 h-2.5 rounded-full ${stops.length > 0 ? 'bg-emerald-500 animate-pulse' : 'bg-slate-300 dark:bg-slate-700'}`} />
                <span className="text-sm font-black text-slate-800 dark:text-slate-200">{t.health_active}</span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3 lg:gap-6">
             <button onClick={toggleTheme} className="p-3 bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-2xl transition-all border border-slate-200 dark:border-slate-700 active:scale-95 text-slate-700 dark:text-slate-300">
                {theme === 'light' ? (
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" /></svg>
                ) : (
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364-6.364l-.707.707M6.343 17.657l-.707.707m12.728 0l-.707-.707M6.343 6.343l-.707-.707" /></svg>
                )}
             </button>

             <div className="relative" ref={langMenuRef}>
                <button onClick={() => setShowLangMenu(!showLangMenu)} className="flex items-center gap-2 px-4 py-3 bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-2xl transition-all border border-slate-200 dark:border-slate-700 active:scale-95 font-black text-xs uppercase text-slate-700 dark:text-slate-300">{lang}</button>
                {showLangMenu && (
                  <div className="absolute top-full right-0 mt-3 w-40 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-[1.5rem] shadow-2xl z-50 overflow-hidden animate-in zoom-in duration-200">
                    {['en', 'es', 'de'].map(l => (
                      <button key={l} onClick={() => { setLang(l as Language); setShowLangMenu(false); }} className={`w-full text-left px-5 py-4 text-xs font-black uppercase transition-colors ${lang === l ? 'bg-blue-600 text-white' : 'hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300'}`}>{l === 'en' ? 'English' : l === 'es' ? 'Español' : 'Deutsch'}</button>
                    ))}
                  </div>
                )}
             </div>

             <div className="relative" ref={profileMenuRef}>
                <button onClick={() => setShowProfileMenu(!showProfileMenu)} className="flex items-center gap-4 pl-4 pr-3 py-2 bg-slate-900 dark:bg-slate-800 text-white rounded-[1.5rem] shadow-xl active:scale-[0.98] transition-all">
                  <span className="text-xs font-black truncate max-w-[120px] hidden sm:block">{dispatcherName}</span>
                  <div className="h-10 w-10 rounded-xl bg-blue-600 flex items-center justify-center">
                      <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg>
                  </div>
                </button>
                {showProfileMenu && (
                  <div className="absolute top-full right-0 mt-3 w-56 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-[1.5rem] shadow-2xl z-50 overflow-hidden animate-in zoom-in-95 origin-top-right">
                    <div className="px-6 py-5 bg-slate-50 dark:bg-slate-900 border-b border-slate-100 dark:border-slate-800">
                      <p className="text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest">{t.welcome}</p>
                      <p className="text-sm font-black text-slate-900 dark:text-slate-100 mt-1">{dispatcherName}</p>
                    </div>
                    <button onClick={handleLogout} className="w-full text-left px-6 py-5 hover:bg-red-50 dark:hover:bg-red-950 text-red-600 dark:text-red-400 text-xs font-black uppercase tracking-widest transition-colors flex items-center gap-3">
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M17 16l4-4m0 0l-4-4m4 4H7" /></svg>
                      {t.logout}
                    </button>
                  </div>
                )}
             </div>
          </div>
        </header>

        <main className="flex-1 p-6 lg:p-10 overflow-hidden relative flex flex-col gap-6 lg:gap-8 bg-slate-50 dark:bg-slate-950">
          <div className="flex-1 bg-white dark:bg-slate-900 rounded-[2.5rem] shadow-xl border border-slate-200 dark:border-slate-800 overflow-hidden relative">
             <RouteMap stops={stops} baseLocation={depotLocation} selectedStopId={selectedStopId} onStopSelect={setSelectedStopId} lang={lang} theme={theme} />
             {isOptimizing && !aiSummary && (
                <div className="absolute inset-0 bg-white/40 dark:bg-slate-950/40 backdrop-blur-[2px] flex items-center justify-center z-50">
                   <div className="bg-slate-900 dark:bg-slate-800 text-white px-8 py-5 rounded-[2rem] shadow-2xl flex items-center gap-5 border border-slate-700 dark:border-slate-600 animate-in fade-in zoom-in">
                      <div className="w-6 h-6 border-4 border-blue-400/30 border-t-blue-400 rounded-full animate-spin" />
                      <span className="text-sm font-black uppercase tracking-[0.2em]">{t.recalculating}</span>
                   </div>
                </div>
             )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 lg:gap-8">
             {[
               {label: t.total_dist, value: `${routeStats.distance.toFixed(1)} km`, icon: "M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7", color: "blue"},
               {label: t.total_dur, value: routeStats.duration, icon: "M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z", color: "indigo"},
               {label: t.manifest_stops, value: `${stops.length} ${t.targets}`, icon: "M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z", color: "emerald"}
             ].map((stat, i) => (
               <div key={i} className="bg-white dark:bg-slate-900 rounded-[1.75rem] p-6 border border-slate-200 dark:border-slate-800 shadow-sm flex items-center gap-5 group hover:shadow-lg dark:hover:shadow-none transition-all duration-300">
                  <div className={`p-4 rounded-2xl bg-${stat.color}-50 dark:bg-${stat.color}-900/20 text-${stat.color}-600 dark:text-${stat.color}-400 group-hover:scale-110 transition-transform`}>
                    <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d={stat.icon} /></svg>
                  </div>
                  <div>
                    <p className="text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-1">{stat.label}</p>
                    <p className="text-2xl font-black text-slate-900 dark:text-slate-100">{stat.value}</p>
                  </div>
               </div>
             ))}
          </div>

          {aiSummary && (
            <div className="bg-slate-900 dark:bg-slate-800 text-white p-8 rounded-[2.5rem] shadow-2xl flex flex-col sm:flex-row gap-6 items-center border border-slate-800 dark:border-slate-700 animate-in slide-in-from-bottom-8 duration-700">
              <div className="bg-blue-600 dark:bg-blue-500 p-5 rounded-3xl border-4 border-slate-800 dark:border-slate-700 shadow-2xl flex-shrink-0">
                <svg className="w-10 h-10 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
              </div>
              <div className="flex-1 text-center sm:text-left">
                <h4 className="text-[10px] font-black text-blue-400 dark:text-blue-300 uppercase tracking-[0.4em] mb-3">{t.report_title}</h4>
                <p className="text-base leading-relaxed text-slate-300 dark:text-slate-100 font-medium italic">"{aiSummary}"</p>
              </div>
              <button onClick={() => setAiSummary(null)} className="text-slate-600 dark:text-slate-400 hover:text-white dark:hover:text-slate-100 p-3 transition-colors flex-shrink-0"><svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" /></svg></button>
            </div>
          )}
        </main>
      </div>

      {/* Save Route Modal */}
      {isSaveModalOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-slate-900/60 backdrop-blur-md animate-in fade-in duration-300">
          <div className="bg-white dark:bg-slate-900 rounded-[2.5rem] shadow-2xl w-full max-w-md overflow-hidden animate-in zoom-in-95 duration-300 border dark:border-slate-800">
            <div className="p-8 bg-slate-900 dark:bg-slate-950 text-white flex justify-between items-center">
              <h3 className="text-xl font-black uppercase tracking-tight">{t.save_route_title}</h3>
              <button onClick={() => setIsSaveModalOpen(false)} className="p-2 hover:bg-white/10 rounded-xl transition-colors"><svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" /></svg></button>
            </div>
            <div className="p-8 space-y-6">
              <div>
                <label className="text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest block mb-3">{t.route_name_label}</label>
                <input autoFocus value={newRouteName} onChange={(e) => setNewRouteName(e.target.value)} placeholder={t.route_name_placeholder} className="w-full px-5 py-4 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-2xl text-base focus:ring-4 focus:ring-blue-500/10 focus:border-blue-600 outline-none transition-all shadow-inner text-slate-900 dark:text-slate-100" />
              </div>
              <div className="flex gap-4">
                <button onClick={() => setIsSaveModalOpen(false)} className="flex-1 py-4 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 rounded-2xl font-black uppercase tracking-widest text-[10px] active:scale-95 transition-all">{t.cancel}</button>
                <button onClick={handleSaveCurrentRoute} disabled={!newRouteName.trim()} className="flex-1 py-4 bg-blue-600 dark:bg-blue-500 text-white rounded-2xl font-black uppercase tracking-widest text-[10px] shadow-xl hover:bg-blue-700 dark:hover:bg-blue-600 active:scale-95 transition-all disabled:opacity-50">{t.save_confirm}</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;
