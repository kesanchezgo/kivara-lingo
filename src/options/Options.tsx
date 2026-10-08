import { useEffect } from 'react';
import { SidePanel } from '../content/ui/SidePanel';
import { useKivaraStore } from '../shared/store';
import { buildPreviewData } from '../shared/preview-data';

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
    <div
      className={`min-h-screen ${isDarkMode ? 'dark bg-zinc-950' : 'bg-zinc-50'} flex items-center justify-center p-8`}
      style={{ colorScheme: isDarkMode ? 'dark' : 'light' }}
    >
      <div className="w-[420px] h-[820px] shadow-2xl overflow-hidden rounded-xl">
        <SidePanel
          isPopupMode={false}
          togglePopupMode={() => {}}
          onClose={() => {}}
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
  );
}
