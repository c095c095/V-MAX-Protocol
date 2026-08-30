// VMP (V MAX Protocol) — shared type/constant definitions used by both server and client.
// Wire-format encoding/decoding itself lives in `codec.ts`, not here.

export const VMP_VERSION = 'VMP/1.0';

export type NodeType = 'TempHumidNode' | 'SoilNode' | 'LightNode';

export const NODE_TYPE_PREFIX: Record<NodeType, string> = {
  TempHumidNode: 'TEMP',
  SoilNode: 'SOIL',
  LightNode: 'LIGHT',
};

export type RequestMethod = 'REGISTER' | 'PUSH' | 'COMMAND' | 'STATUS' | 'UNREGISTER';

export type CommandName =
  | 'SET_INTERVAL'
  | 'REPORT_NOW'
  | 'SET_THRESHOLD'
  | 'CALIBRATE'
  | 'SHUTDOWN';

export const STATUS_PHRASES: Record<number, string> = {
  200: 'OK',
  201: 'Registered',
  400: 'BadRequest',
  401: 'Unregistered',
  403: 'Forbidden',
  404: 'NodeNotFound',
  409: 'DuplicateNode',
  500: 'InternalError',
};

export interface ParsedRequest {
  kind: 'request';
  method: RequestMethod;
  version: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

export interface ParsedResponse {
  kind: 'response';
  version: string;
  statusCode: number;
  statusPhrase: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

export type ParsedMessage = ParsedRequest | ParsedResponse;
