
import { DeliveryStop, Coordinate } from '../types';

export const calculateDistance = (p1: Coordinate, p2: Coordinate): number => {
  // Simple Euclidean distance for the demo (in a real app, use Haversine or Maps API)
  const dy = p1.lat - p2.lat;
  const dx = p1.lng - p2.lng;
  return Math.sqrt(dx * dx + dy * dy);
};

export const optimizeRoute = (start: Coordinate, stops: DeliveryStop[]): DeliveryStop[] => {
  if (stops.length === 0) return [];

  const unvisited = [...stops];
  const route: DeliveryStop[] = [];
  let currentPos = start;

  while (unvisited.length > 0) {
    let nearestIndex = 0;
    let minDistance = calculateDistance(currentPos, unvisited[0].coords);

    for (let i = 1; i < unvisited.length; i++) {
      const dist = calculateDistance(currentPos, unvisited[i].coords);
      // Priority bonus: high priority stops effectively "closer"
      const priorityWeight = unvisited[i].priority === 'high' ? 0.7 : unvisited[i].priority === 'medium' ? 0.9 : 1.0;
      const weightedDist = dist * priorityWeight;
      
      if (weightedDist < minDistance) {
        minDistance = weightedDist;
        nearestIndex = i;
      }
    }

    const nextStop = unvisited.splice(nearestIndex, 1)[0];
    route.push(nextStop);
    currentPos = nextStop.coords;
  }

  return route;
};
