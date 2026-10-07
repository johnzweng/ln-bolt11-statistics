// Lightning node IDs that the dashboard labels by name.
// Only add entries that a primary source documents, and say no more than that source says.
//
// Spark lists these two public keys as "our routing nodes" for opening channels
// to improve routing to/from Spark wallets. This is not an exhaustive list of
// Spark invoice destinations, nor evidence that a particular payment used them.

const SPARK_ROUTING_NODE = {
  label: 'Spark routing node',
  operator: 'Spark (developed by Lightspark)',
  // Listed as "our routing nodes" in the official Spark documentation:
  source: 'https://docs.spark.money/learn/lightning#routing-nodes',
  network: 'bc',
};

export const KNOWN_NODES = {
  '02a98e8c590a1b5602049d6b21d8f4c8861970aa310762f42eae1b2be88372e924': SPARK_ROUTING_NODE,
  '039174f846626c6053ba80f5443d0db33da384f1dde135bf7080ba1eec465019c3': SPARK_ROUTING_NODE,
};

/** Static, source-cited identity hints, never inferred from aliases or invoice markers. */
export function knownNode(network, pubkey) {
  const info = Object.hasOwn(KNOWN_NODES, pubkey) ? KNOWN_NODES[pubkey] : null;
  return info?.network === network ? info : null;
}
