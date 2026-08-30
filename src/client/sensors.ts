import { NodeType } from '../protocol/types';

// Mutable node state that COMMAND messages from the server can change at runtime, and that
// the connection layer (pushTimer) and index.ts's push loop both need to read/write. Passed
// by reference so mutations here are visible wherever the same object is held.
export interface ClientState {
  calibrationOffset: number;
  threshold: { field: string; min: number } | null;
  pushTimer: NodeJS.Timeout | null;
  intervalSeconds: number;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** Generates a plausible reading for this node's type, applying calibration offset. */
export function generateReading(nodeType: NodeType, state: ClientState): Record<string, unknown> {
  const timestamp = new Date().toISOString().replace('Z', '+07:00');
  switch (nodeType) {
    case 'TempHumidNode':
      return {
        temperature: round1(28 + Math.random() * 4 + state.calibrationOffset),
        humidity: round1(55 + Math.random() * 20),
        timestamp,
      };
    case 'SoilNode':
      return {
        soil_ph: round1(6.5 + Math.random() * 1 + state.calibrationOffset),
        soil_moisture: round1(15 + Math.random() * 40),
        timestamp,
      };
    case 'LightNode':
      return {
        light_intensity: Math.round(8000 + Math.random() * 12000 + state.calibrationOffset * 1000),
        timestamp,
      };
  }
}

export function fieldValue(reading: Record<string, unknown>, field: string): number | undefined {
  const v = reading[field];
  return typeof v === 'number' ? v : undefined;
}
