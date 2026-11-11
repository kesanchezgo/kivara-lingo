/** Types for scripts/build-icons.mjs (imported by the icon budget test). */

export declare const REPO_ROOT: string;
export declare const GENERATED_PATH: string;

export interface IconScanResult {
  icons: Map<string, Set<string>>;
  imported: Set<string>;
  scannedFiles: number;
}

export interface GeneratedIcons {
  content: string;
  names: string[];
  importedNames: string[];
  variants: string[];
  scannedFiles: number;
}

export declare function scanIconUsage(): IconScanResult;
export declare function generateIcons(): Promise<GeneratedIcons>;