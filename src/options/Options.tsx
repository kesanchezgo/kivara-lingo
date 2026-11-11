import { useEffect } from 'react';
import { SidePanel } from '../content/ui/SidePanel';
import { useKivaraStore } from '../shared/use-kivara-store';
import { buildPreviewData } from '../shared/preview-data';
import { PortsProvider } from '../ui/ports/PortsProvider';
import { createOptionsPorts } from './ports';

/** Built once: the ports are stateless wrappers over service-worker messages. */
const PORTS = createOptionsPorts();

export function Options() {
  const {
    isDarkMode,
    subtitleStyles,
    ankiMapping,
    setIsDarkMode,
    setSubtitleStyles,
    setAnkiMapping,
  } = useKivaraStore();

  useEffect(() => {
    document.documentElement.classList.toggle('dark', isDarkMode);
  }, [isDarkMode]);

  // Single source of preview data (no local copy of the placeholder):
  // Options has no live cue, so it renders the deterministic sample.
  const mockData = buildPreviewData();

  return (
    <PortsProvider ports={PORTS}>
      <div
        className={`min-h-screen ${isDarkMode ? 'dark bg-zinc-950' : 'bg-zinc-50'} flex items-center justify-center p-8`}
        style={{ colorScheme: isDarkMode ? 'dark' : 'light' }}
      >
        <div className="w-[460px] h-[860px] shadow-2xl overflow-hidden rounded-xl">
          <SidePanel
            isPopupMode={false}
            isDarkMode={isDarkMode}
            toggleDarkMode={() => setIsDarkMode(!isDarkMode)}
            styles={subtitleStyles}
            setStyles={setSubtitleStyles}
            mapping={ankiMapping}
            setMapping={setAnkiMapping}
            mockData={mockData}
          />
        </div>
      </div>
    </PortsProvider>
  );
}
