// The states Tecstellar's customers are in, with the language agents speak there. Plain data, so the server can read it
// too (src/lib/appSync.ts); the Vanmoh build has its own list in seedVanmoh.ts.
import type { StateDef } from './types.ts';

export interface StateSeedDef extends StateDef {
  weight: number;
  cities: string[];
}

export const TECSTELLAR_STATES: StateSeedDef[] = [
  { name: 'Tamil Nadu', lon: 78.4, lat: 11.0, language: 'Tamil', weight: 5768, cities: ['Chennai', 'Coimbatore', 'Madurai', 'Tiruppur', 'Salem', 'Erode', 'Trichy', 'Karur', 'Pollachi', 'Vellore'] },
  { name: 'Karnataka', lon: 76.2, lat: 14.6, language: 'Kannada', weight: 1420, cities: ['Bengaluru', 'Mysuru', 'Hubballi', 'Mangaluru'] },
  { name: 'Telangana', lon: 79.0, lat: 17.9, language: 'Telugu', weight: 980, cities: ['Hyderabad', 'Warangal', 'Nizamabad'] },
  { name: 'Andhra Pradesh', lon: 80.2, lat: 15.6, language: 'Telugu', weight: 860, cities: ['Vijayawada', 'Visakhapatnam', 'Guntur'] },
  { name: 'Kerala', lon: 76.4, lat: 10.2, language: 'Malayalam', weight: 720, cities: ['Kochi', 'Thiruvananthapuram', 'Kozhikode'] },
  { name: 'Maharashtra', lon: 75.5, lat: 19.4, language: 'Hindi', weight: 610, cities: ['Mumbai', 'Pune', 'Nagpur'] },
  { name: 'Delhi', lon: 77.1, lat: 28.6, language: 'Hindi', weight: 340, cities: ['New Delhi', 'Dwarka', 'Rohini'] },
  { name: 'Uttar Pradesh', lon: 80.8, lat: 26.9, language: 'Hindi', weight: 290, cities: ['Lucknow', 'Kanpur', 'Noida'] },
  { name: 'Gujarat', lon: 71.8, lat: 22.4, language: 'Hindi', weight: 210, cities: ['Ahmedabad', 'Surat', 'Vadodara'] },
  { name: 'West Bengal', lon: 87.8, lat: 23.5, language: 'Hindi', weight: 120, cities: ['Kolkata', 'Howrah', 'Siliguri'] },
  { name: 'Rajasthan', lon: 74.2, lat: 27.0, language: 'Hindi', weight: 62, cities: ['Jaipur', 'Jodhpur'] },
  { name: 'Madhya Pradesh', lon: 78.5, lat: 23.5, language: 'Hindi', weight: 50, cities: ['Bhopal', 'Indore'] },
];
