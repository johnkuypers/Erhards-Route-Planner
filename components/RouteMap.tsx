
import React, { useEffect, useRef } from 'react';
import * as d3 from 'd3';
import { DeliveryStop, Coordinate, TrafficCondition } from '../types';
import { Language, translations } from '../translations';

interface RouteMapProps {
  stops: DeliveryStop[];
  baseLocation: Coordinate;
  selectedStopId?: string | null;
  onStopSelect: (id: string) => void;
  lang: Language;
  theme: 'light' | 'dark';
}

const RouteMap: React.FC<RouteMapProps> = ({ stops, baseLocation, selectedStopId, onStopSelect, lang, theme }) => {
  const svgRef = useRef<SVGSVGElement>(null);
  const zoomRef = useRef<d3.ZoomBehavior<SVGSVGElement, unknown>>(null);
  const t = translations[lang];

  // Simple distance calculation helper
  const calculateDist = (p1: Coordinate, p2: Coordinate): number => {
    const dy = p1.lat - p2.lat;
    const dx = p1.lng - p2.lng;
    return Math.sqrt(dx * dx + dy * dy) * 111; // 111 km per degree approx
  };

  const getTrafficColor = (condition?: TrafficCondition) => {
    switch (condition) {
      case 'heavy': return '#ef4444';
      case 'moderate': return '#f59e0b';
      case 'light': return '#10b981';
      default: return theme === 'dark' ? '#60a5fa' : '#3b82f6';
    }
  };

  const handleZoomIn = () => {
    if (svgRef.current) d3.select(svgRef.current).transition().duration(300).call(zoomRef.current!.scaleBy, 1.5);
  };

  const handleZoomOut = () => {
    if (svgRef.current) d3.select(svgRef.current).transition().duration(300).call(zoomRef.current!.scaleBy, 0.66);
  };

  const handleResetZoom = () => {
    if (svgRef.current) {
      d3.select(svgRef.current).transition().duration(500).call(zoomRef.current!.transform, d3.zoomIdentity);
    }
  };

  useEffect(() => {
    if (!svgRef.current) return;

    const width = svgRef.current.clientWidth;
    const height = svgRef.current.clientHeight;
    const padding = 80;

    const svg = d3.select(svgRef.current);
    svg.selectAll("*").remove();

    // Create a container group for zooming
    const container = svg.append("g").attr("class", "map-container");

    // Initialize Zoom behavior
    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.5, 10])
      .on("zoom", (event) => {
        container.attr("transform", event.transform);
      });

    svg.call(zoom);
    (zoomRef as any).current = zoom;

    const allPoints = [baseLocation, ...stops.map(s => s.coords)];
    
    const xScale = d3.scaleLinear()
      .domain([d3.min(allPoints, d => d.lng)! - 0.005, d3.max(allPoints, d => d.lng)! + 0.005])
      .range([padding, width - padding]);

    const yScale = d3.scaleLinear()
      .domain([d3.min(allPoints, d => d.lat)! - 0.005, d3.max(allPoints, d => d.lat)! + 0.005])
      .range([height - padding, padding]);

    const g = container.append("g");
    
    if (stops.length > 0) {
      const segments = [
        { start: baseLocation, end: stops[0].coords, traffic: stops[0].trafficCondition, targetId: stops[0].id },
        ...stops.slice(0, -1).map((s, i) => ({
          start: s.coords,
          end: stops[i+1].coords,
          traffic: stops[i+1].trafficCondition,
          targetId: stops[i+1].id
        }))
      ];

      segments.forEach((seg, idx) => {
        const lineData = [seg.start, seg.end];
        const lineGenerator = d3.line<Coordinate>()
          .x(d => xScale(d.lng))
          .y(d => yScale(d.lat));

        const isSelected = selectedStopId === seg.targetId;
        const color = getTrafficColor(seg.traffic);

        // Path Glow/Background
        g.append("path")
          .datum(lineData)
          .attr("fill", "none")
          .attr("stroke", color)
          .attr("stroke-width", isSelected ? 12 : 6)
          .attr("stroke-linecap", "round")
          .attr("opacity", isSelected ? 0.4 : 0.15)
          .attr("d", lineGenerator)
          .attr("class", isSelected ? "animate-pulse" : "");

        // Main Route Path
        const path = g.append("path")
          .datum(lineData)
          .attr("fill", "none")
          .attr("stroke", color)
          .attr("stroke-width", isSelected ? 6 : 3.5)
          .attr("stroke-linecap", "round")
          .attr("d", lineGenerator);

        const totalLength = (path.node() as SVGPathElement).getTotalLength();
        
        if (isSelected) {
            path
                .attr("stroke-dasharray", `4, 4`)
                .attr("stroke-width", 6)
                .append("animate")
                .attr("attributeName", "stroke-dashoffset")
                .attr("from", "0")
                .attr("to", "20")
                .attr("dur", "0.5s")
                .attr("repeatCount", "indefinite");
        } else {
            path
                .attr("stroke-dasharray", `${totalLength} ${totalLength}`)
                .attr("stroke-dashoffset", totalLength)
                .transition()
                .duration(800)
                .delay(idx * 200)
                .attr("stroke-dashoffset", 0);
        }

        // --- SEGMENT DISTANCE LABELS ---
        const dist = calculateDist(seg.start, seg.end);
        const midX = (xScale(seg.start.lng) + xScale(seg.end.lng)) / 2;
        const midY = (yScale(seg.start.lat) + yScale(seg.end.lat)) / 2;
        const distanceText = `${dist.toFixed(1)}km`;
        
        const pillWidth = Math.max(42, distanceText.length * 7 + 16);
        const pillHeight = 20;

        const labelGroup = g.append("g")
          .attr("class", "distance-label")
          .style("opacity", 0)
          .style("pointer-events", "none");

        // Pill Backdrop
        labelGroup.append("rect")
          .attr("x", midX - pillWidth/2)
          .attr("y", midY - pillHeight/2)
          .attr("width", pillWidth)
          .attr("height", pillHeight)
          .attr("rx", pillHeight/2)
          .attr("fill", theme === 'dark' ? '#1e293b' : 'white')
          .attr("stroke", isSelected ? color : theme === 'dark' ? '#334155' : color + '40')
          .attr("stroke-width", isSelected ? 2 : 1)
          .attr("filter", "drop-shadow(0px 2px 4px rgba(0,0,0,0.1))");

        // Distance Text
        labelGroup.append("text")
          .attr("x", midX)
          .attr("y", midY + 4)
          .attr("text-anchor", "middle")
          .attr("font-size", "9px")
          .attr("font-weight", "800")
          .attr("fill", isSelected ? color : theme === 'dark' ? '#94a3b8' : "#475569")
          .attr("font-family", "Inter, sans-serif")
          .text(distanceText);

        labelGroup.transition()
          .duration(500)
          .delay(idx * 200 + 400)
          .style("opacity", 1);
      });
    }

    // Depot icon
    g.append("circle")
      .attr("cx", xScale(baseLocation.lng))
      .attr("cy", yScale(baseLocation.lat))
      .attr("r", 10)
      .attr("fill", theme === 'dark' ? '#60a5fa' : '#1e293b')
      .attr("stroke", theme === 'dark' ? '#1e293b' : 'white')
      .attr("stroke-width", 3);

    g.append("text")
      .attr("x", xScale(baseLocation.lng))
      .attr("y", yScale(baseLocation.lat) - 18)
      .attr("text-anchor", "middle")
      .attr("font-size", "12px")
      .attr("font-weight", "800")
      .attr("fill", theme === 'dark' ? '#f8fafc' : '#1e293b')
      .text(t.hq);

    // Stops
    const stopGroups = g.selectAll(".stop")
      .data(stops)
      .enter()
      .append("g")
      .attr("class", "stop")
      .style("cursor", "pointer")
      .on("click", (event, d) => {
        onStopSelect(d.id);
      });

    stopGroups.each(function(d, i) {
      const isSelected = selectedStopId === d.id;
      const group = d3.select(this);

      if (isSelected) {
          group.append("circle")
            .attr("cx", xScale(d.coords.lng))
            .attr("cy", yScale(d.coords.lat))
            .attr("r", 16)
            .attr("fill", "none")
            .attr("stroke", "#3b82f6")
            .attr("stroke-width", 2)
            .attr("stroke-dasharray", "4,2")
            .append("animateTransform")
            .attr("attributeName", "transform")
            .attr("type", "rotate")
            .attr("from", `0 ${xScale(d.coords.lng)} ${yScale(d.coords.lat)}`)
            .attr("to", `360 ${xScale(d.coords.lng)} ${yScale(d.coords.lat)}`)
            .attr("dur", "4s")
            .attr("repeatCount", "indefinite");
      }

      group.append("circle")
        .attr("cx", xScale(d.coords.lng))
        .attr("cy", yScale(d.coords.lat))
        .attr("r", isSelected ? 10 : 8)
        .attr("fill", isSelected ? '#3b82f6' : (d.priority === 'high' ? (theme === 'dark' ? '#3b82f6' : '#60a5fa') : (theme === 'dark' ? '#475569' : '#94a3b8')))
        .attr("stroke", theme === 'dark' ? '#1e293b' : 'white')
        .attr("stroke-width", isSelected ? 3 : 2)
        .attr("opacity", 1);

      const label = group.append("text")
        .attr("x", xScale(d.coords.lng))
        .attr("y", yScale(d.coords.lat) + (isSelected ? 26 : 22))
        .attr("text-anchor", "middle")
        .attr("font-family", "Inter, sans-serif");

      label.append("tspan")
        .attr("font-size", isSelected ? "11px" : "10px")
        .attr("font-weight", isSelected ? "800" : "700")
        .attr("fill", isSelected ? (theme === 'dark' ? '#60a5fa' : "#1e40af") : (theme === 'dark' ? '#f1f5f9' : "#1e293b"))
        .text(`${i + 1}: ${d.customerName}`);

      if (d.estimatedTime) {
        label.append("tspan")
          .attr("x", xScale(d.coords.lng))
          .attr("dy", "1.2em")
          .attr("font-size", "9px")
          .attr("font-weight", "600")
          .attr("fill", theme === 'dark' ? '#94a3b8' : "#64748b")
          .text(`${t.eta}: ${d.estimatedTime}`);
      }
    });

  }, [stops, baseLocation, selectedStopId, onStopSelect, lang, theme, t.hq, t.eta]);

  return (
    <div className="w-full h-full bg-slate-50 dark:bg-slate-900 rounded-2xl shadow-inner border border-slate-200 dark:border-slate-800 overflow-hidden relative">
      {/* Legend */}
      <div className="absolute top-4 right-4 flex flex-col gap-2 z-10">
        <div className="bg-white/95 dark:bg-slate-800/95 backdrop-blur px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 text-[10px] shadow-sm">
          <p className="font-bold text-slate-400 dark:text-slate-500 uppercase mb-2 tracking-wider">{t.traffic_legend}</p>
          <div className="flex items-center gap-2 mb-1.5">
            <div className="w-3.5 h-1 rounded-full bg-emerald-500"></div> <span className="text-slate-700 dark:text-slate-300 font-semibold uppercase tracking-tight">{t.traffic_light}</span>
          </div>
          <div className="flex items-center gap-2 mb-1.5">
            <div className="w-3.5 h-1 rounded-full bg-amber-500"></div> <span className="text-slate-700 dark:text-slate-300 font-semibold uppercase tracking-tight">{t.traffic_moderate}</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3.5 h-1 rounded-full bg-red-500"></div> <span className="text-slate-700 dark:text-slate-300 font-semibold uppercase tracking-tight">{t.traffic_heavy}</span>
          </div>
        </div>
      </div>

      {/* Zoom Controls */}
      <div className="absolute bottom-6 right-6 flex flex-col gap-2 z-10">
        <div className="bg-white/95 dark:bg-slate-800/95 backdrop-blur p-1.5 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-xl flex flex-col gap-1">
          <button 
            onClick={handleZoomIn}
            className="w-10 h-10 flex items-center justify-center rounded-xl bg-white dark:bg-slate-700 hover:bg-slate-50 dark:hover:bg-slate-600 text-slate-600 dark:text-slate-200 transition-all border border-slate-100 dark:border-slate-600 hover:shadow-md active:scale-90"
            title="Zoom In"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" /></svg>
          </button>
          <button 
            onClick={handleZoomOut}
            className="w-10 h-10 flex items-center justify-center rounded-xl bg-white dark:bg-slate-700 hover:bg-slate-50 dark:hover:bg-slate-600 text-slate-600 dark:text-slate-200 transition-all border border-slate-100 dark:border-slate-600 hover:shadow-md active:scale-90"
            title="Zoom Out"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M20 12H4" /></svg>
          </button>
          <div className="h-px bg-slate-100 dark:bg-slate-600 mx-2 my-0.5"></div>
          <button 
            onClick={handleResetZoom}
            className="w-10 h-10 flex items-center justify-center rounded-xl bg-blue-50 dark:bg-blue-900/40 hover:bg-blue-100 dark:hover:bg-blue-900/60 text-blue-600 dark:text-blue-400 transition-all border border-blue-100 dark:border-blue-900/60 hover:shadow-md active:scale-90"
            title="Reset View"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
          </button>
        </div>
      </div>

      <svg ref={svgRef} className="w-full h-full cursor-grab active:cursor-grabbing" />
    </div>
  );
};

export default RouteMap;
