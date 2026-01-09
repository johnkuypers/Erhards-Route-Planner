
export interface Coordinate {
  lat: number;
  lng: number;
}

export type TrafficCondition = 'light' | 'moderate' | 'heavy';

export interface DeliveryStop {
  id: string;
  address: string;
  customerName: string;
  priority: 'low' | 'medium' | 'high';
  coords: Coordinate;
  estimatedTime?: string;
  trafficCondition?: TrafficCondition;
}

export interface Customer {
  id: string;
  name: string;
  address: string;
  coords: Coordinate;
}

export interface SavedRoute {
  id: string;
  name: string;
  stops: DeliveryStop[];
  date: string;
  totalDistance: number;
}

export interface OptimizedRoute {
  stops: DeliveryStop[];
  totalDistance: number;
  totalDuration: number;
  aiAnalysis?: string;
}

export interface GeocodingResult {
  address: string;
  coords: Coordinate;
}