import * as net from 'net';
import { NodeType } from '../protocol/types';

export interface RegisteredNode {
  nodeId: string;
  nodeType: NodeType;
  plotId: string;
  socket: net.Socket;
  lastSeq: number; // highest `Seq` seen on a PUSH from this node (ADR 0006); 0 = none yet
}

// Node-ID -> registration info. This is the server's connection table: it's how we find
// a node's live socket later when an operator wants to send it a COMMAND, and how the
// operator REPL's Plot-ID broadcast (ADR 0010) finds every node in a plot.
export const nodes = new Map<string, RegisteredNode>();
