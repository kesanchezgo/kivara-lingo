/**
 * React context that hands the port implementations to the view tree
 * (docs/REDESIGN-V2.md §4.2).
 *
 * The same `<PortsProvider>` wraps the tree in the content script, in Options
 * and in the component tests, so a view never reaches for `chrome.*` or a
 * concrete engine directly — it reads `usePorts()`.
 */
import { createContext, useContext, type ReactNode } from 'react';
import type { AiPort } from './ai';
import type { AnkiPort } from './anki';
import type { EpisodePort } from './episode';
import type { LexiconPort } from './lexicon';
import type { PacksPort } from './packs';

/** The full set of ports a mounted view tree needs. */
export interface Ports {
  lexicon: LexiconPort;
  episode: EpisodePort;
  anki: AnkiPort;
  ai: AiPort;
  packs: PacksPort;
}

const PortsContext = createContext<Ports | null>(null);

export function PortsProvider({ ports, children }: { ports: Ports; children: ReactNode }) {
  return <PortsContext.Provider value={ports}>{children}</PortsContext.Provider>;
}

/** Read the ports from context. Throws outside a `<PortsProvider>`. */
export function usePorts(): Ports {
  const ports = useContext(PortsContext);
  if (!ports) {
    throw new Error(
      'usePorts() must be used inside a <PortsProvider>. Wrap the tree (content script, Options, tests) with PortsProvider and pass a Ports object.',
    );
  }
  return ports;
}
