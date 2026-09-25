// Lecture pure (sans réseau) du contrat de la machine d'état de livraison.
// Séparé de deliveryContract.js pour être testable sous Node.

// Actions prévues par le contrat pour un acteur ("admin" | "merchant" | "courier" | "client" | "system")
// depuis un statut donné. Retourne des objets { action, to }.
export function contractActionsFor(contract, actor, fromStatus) {
  if (!contract || !Array.isArray(contract.transitions)) return [];
  return contract.transitions
    .filter((t) => t.actor_scope === actor && t.from === fromStatus)
    .map((t) => ({ action: t.action, to: t.to }));
}

export function isTerminalStatus(contract, status) {
  return !!contract && Array.isArray(contract.terminal_statuses) && contract.terminal_statuses.includes(status);
}
