/**
 * Icon layer — Phosphor Icons behind the lucide-style API the components use
 * (`size`, `className`, `strokeWidth`). Swapping the set happens here only.
 * `strokeWidth` maps onto Phosphor weights: <=1.75 light · 2 regular · >=2.5 bold.
 * Pass `weight` directly for fill / duotone accents.
 */
import React from 'react';
import {
  ArrowCounterClockwise as PArrowCounterClockwise,
  ArrowUUpLeft as PArrowUUpLeft,
  ArrowSquareOut as PArrowSquareOut,
  ArrowsClockwise as PArrowsClockwise,
  ArrowsHorizontal as PArrowsHorizontal,
  ArrowsLeftRight as PArrowsLeftRight,
  ArrowsVertical as PArrowsVertical,
  BookBookmark as PBookBookmark,
  BookOpen as PBookOpen,
  BookOpenText as PBookOpenText,
  Books as PBooks,
  Brain as PBrain,
  Camera as PCamera,
  CaretDown as PCaretDown,
  CaretUp as PCaretUp,
  Ear as PEar,
  Repeat as PRepeat,
  CaretLeft as PCaretLeft,
  CaretRight as PCaretRight,
  ChartBar as PChartBar,
  Check as PCheck,
  CheckCircle as PCheckCircle,
  CircleNotch as PCircleNotch,
  Clock as PClock,
  ClockCounterClockwise as PClockCounterClockwise,
  Cloud as PCloud,
  CloudSlash as PCloudSlash,
  Coffee as PCoffee,
  Copy as PCopy,
  CornersOut as PCornersOut,
  Cpu as PCpu,
  CursorClick as PCursorClick,
  Database as PDatabase,
  DotsSixVertical as PDotsSixVertical,
  DownloadSimple as PDownloadSimple,
  Eye as PEye,
  EyeSlash as PEyeSlash,
  FileText as PFileText,
  FloppyDisk as PFloppyDisk,
  GearSix as PGearSix,
  GithubLogo as PGithubLogo,
  Globe as PGlobe,
  GraduationCap as PGraduationCap,
  Heart as PHeart,
  Info as PInfo,
  Key as PKey,
  Keyboard as PKeyboard,
  Lightning as PLightning,
  LinkSimple as PLinkSimple,
  ListChecks as PListChecks,
  MagicWand as PMagicWand,
  MagnifyingGlass as PMagnifyingGlass,
  Microphone as PMicrophone,
  MicrophoneSlash as PMicrophoneSlash,
  MicrophoneStage as PMicrophoneStage,
  Moon as PMoon,
  Package as PPackage,
  Palette as PPalette,
  Pause as PPause,
  Play as PPlay,
  Plug as PPlug,
  PlugsConnected as PPlugsConnected,
  Plus as PPlus,
  Power as PPower,
  Prohibit as PProhibit,
  Quotes as PQuotes,
  Rocket as PRocket,
  ShieldCheck as PShieldCheck,
  ShieldWarning as PShieldWarning,
  SkipForward as PSkipForward,
  Sparkle as PSparkle,
  SpeakerHigh as PSpeakerHigh,
  SpeakerLow as PSpeakerLow,
  SquaresFour as PSquaresFour,
  Stack as PStack,
  Subtitles as PSubtitles,
  FilmSlate as PFilmSlate,
  Sun as PSun,
  TextAa as PTextAa,
  TextAlignLeft as PTextAlignLeft,
  Translate as PTranslate,
  Trash as PTrash,
  UploadSimple as PUploadSimple,
  Warning as PWarning,
  WarningCircle as PWarningCircle,
  Waveform as PWaveform,
  X as PX,
  ArrowLeft as PArrowLeft,
  ArrowRight as PArrowRight,
  Timer as PTimer,
  Sliders as PSlidersHorizontal,
  LockSimple as PLockSimple,
  PaypalLogo as PPaypalLogo,
  type Icon as PhosphorIcon,
  type IconWeight,
} from '@phosphor-icons/react';

export interface IconProps extends Omit<React.SVGProps<SVGSVGElement>, 'ref'> {
  size?: number | string;
  strokeWidth?: number | string;
  weight?: IconWeight;
  className?: string;
}

export type IconComponent = React.FC<IconProps>;

function weightFor(strokeWidth?: number | string): IconWeight {
  const w = Number(strokeWidth ?? 2);
  if (w >= 2.5) return 'bold';
  if (w <= 1.75) return 'light';
  return 'regular';
}

function wrap(Cmp: PhosphorIcon, name: string): IconComponent {
  // lucide's `fill="currentColor"` (solid play/pause) maps to Phosphor's fill weight.
  const C: IconComponent = ({ size = 24, strokeWidth, weight, fill, ...rest }) => (
    <Cmp
      size={size}
      weight={weight ?? (fill && fill !== 'none' ? 'fill' : weightFor(strokeWidth))}
      {...(rest as object)}
    />
  );
  C.displayName = name;
  return C;
}

export const AlertCircle = /*#__PURE__*/ wrap(PWarningCircle, 'AlertCircle');
export const AlertTriangle = /*#__PURE__*/ wrap(PWarning, 'AlertTriangle');
export const AlignLeft = /*#__PURE__*/ wrap(PTextAlignLeft, 'AlignLeft');
export const AlignVerticalSpaceBetween = /*#__PURE__*/ wrap(PArrowsVertical, 'AlignVerticalSpaceBetween');
export const ArrowLeftRight = /*#__PURE__*/ wrap(PArrowsLeftRight, 'ArrowLeftRight');
export const AudioLines = /*#__PURE__*/ wrap(PWaveform, 'AudioLines');
export const Ban = /*#__PURE__*/ wrap(PProhibit, 'Ban');
export const BarChart3 = /*#__PURE__*/ wrap(PChartBar, 'BarChart3');
export const BookOpen = /*#__PURE__*/ wrap(PBookOpen, 'BookOpen');
export const BookOpenCheck = /*#__PURE__*/ wrap(PBookBookmark, 'BookOpenCheck');
export const BookText = /*#__PURE__*/ wrap(PBookOpenText, 'BookText');
export const Brain = /*#__PURE__*/ wrap(PBrain, 'Brain');
export const Camera = /*#__PURE__*/ wrap(PCamera, 'Camera');
export const Check = /*#__PURE__*/ wrap(PCheck, 'Check');
export const CheckCircle2 = /*#__PURE__*/ wrap(PCheckCircle, 'CheckCircle2');
export const ChevronDown = /*#__PURE__*/ wrap(PCaretDown, 'ChevronDown');
export const ChevronUp = /*#__PURE__*/ wrap(PCaretUp, 'ChevronUp');
export const Ear = /*#__PURE__*/ wrap(PEar, 'Ear');
export const Repeat = /*#__PURE__*/ wrap(PRepeat, 'Repeat');
export const ChevronLeft = /*#__PURE__*/ wrap(PCaretLeft, 'ChevronLeft');
export const ChevronRight = /*#__PURE__*/ wrap(PCaretRight, 'ChevronRight');
export const ChevronsLeftRight = /*#__PURE__*/ wrap(PArrowsHorizontal, 'ChevronsLeftRight');
export const Clock = /*#__PURE__*/ wrap(PClock, 'Clock');
export const Cloud = /*#__PURE__*/ wrap(PCloud, 'Cloud');
export const CloudOff = /*#__PURE__*/ wrap(PCloudSlash, 'CloudOff');
export const Coffee = /*#__PURE__*/ wrap(PCoffee, 'Coffee');
export const Copy = /*#__PURE__*/ wrap(PCopy, 'Copy');
export const Cpu = /*#__PURE__*/ wrap(PCpu, 'Cpu');
export const Database = /*#__PURE__*/ wrap(PDatabase, 'Database');
export const Download = /*#__PURE__*/ wrap(PDownloadSimple, 'Download');
export const ExternalLink = /*#__PURE__*/ wrap(PArrowSquareOut, 'ExternalLink');
export const Eye = /*#__PURE__*/ wrap(PEye, 'Eye');
export const EyeOff = /*#__PURE__*/ wrap(PEyeSlash, 'EyeOff');
export const FileText = /*#__PURE__*/ wrap(PFileText, 'FileText');
export const Github = /*#__PURE__*/ wrap(PGithubLogo, 'Github');
export const Globe = /*#__PURE__*/ wrap(PGlobe, 'Globe');
export const GraduationCap = /*#__PURE__*/ wrap(PGraduationCap, 'GraduationCap');
export const GripVertical = /*#__PURE__*/ wrap(PDotsSixVertical, 'GripVertical');
export const Heart = /*#__PURE__*/ wrap(PHeart, 'Heart');
export const History = /*#__PURE__*/ wrap(PClockCounterClockwise, 'History');
export const Info = /*#__PURE__*/ wrap(PInfo, 'Info');
export const KeyRound = /*#__PURE__*/ wrap(PKey, 'KeyRound');
export const Keyboard = /*#__PURE__*/ wrap(PKeyboard, 'Keyboard');
export const Languages = /*#__PURE__*/ wrap(PTranslate, 'Languages');
export const Layers = /*#__PURE__*/ wrap(PStack, 'Layers');
export const LayoutGrid = /*#__PURE__*/ wrap(PSquaresFour, 'LayoutGrid');
export const Library = /*#__PURE__*/ wrap(PBooks, 'Library');
export const Link2 = /*#__PURE__*/ wrap(PLinkSimple, 'Link2');
export const ListChecks = /*#__PURE__*/ wrap(PListChecks, 'ListChecks');
export const Loader2 = /*#__PURE__*/ wrap(PCircleNotch, 'Loader2');
export const Maximize = /*#__PURE__*/ wrap(PCornersOut, 'Maximize');
export const Mic = /*#__PURE__*/ wrap(PMicrophone, 'Mic');
export const Mic2 = /*#__PURE__*/ wrap(PMicrophoneStage, 'Mic2');
export const MicOff = /*#__PURE__*/ wrap(PMicrophoneSlash, 'MicOff');
export const Moon = /*#__PURE__*/ wrap(PMoon, 'Moon');
export const MousePointerClick = /*#__PURE__*/ wrap(PCursorClick, 'MousePointerClick');
export const Package = /*#__PURE__*/ wrap(PPackage, 'Package');
export const Palette = /*#__PURE__*/ wrap(PPalette, 'Palette');
export const Pause = /*#__PURE__*/ wrap(PPause, 'Pause');
export const Play = /*#__PURE__*/ wrap(PPlay, 'Play');
export const Plug = /*#__PURE__*/ wrap(PPlug, 'Plug');
export const PlugZap = /*#__PURE__*/ wrap(PPlugsConnected, 'PlugZap');
export const Plus = /*#__PURE__*/ wrap(PPlus, 'Plus');
export const Power = /*#__PURE__*/ wrap(PPower, 'Power');
export const PowerOff = /*#__PURE__*/ wrap(PPower, 'PowerOff');
export const Quote = /*#__PURE__*/ wrap(PQuotes, 'Quote');
export const RefreshCw = /*#__PURE__*/ wrap(PArrowsClockwise, 'RefreshCw');
export const Rocket = /*#__PURE__*/ wrap(PRocket, 'Rocket');
export const RotateCcw = /*#__PURE__*/ wrap(PArrowCounterClockwise, 'RotateCcw');
export const Save = /*#__PURE__*/ wrap(PFloppyDisk, 'Save');
export const Search = /*#__PURE__*/ wrap(PMagnifyingGlass, 'Search');
export const Settings = /*#__PURE__*/ wrap(PGearSix, 'Settings');
export const ShieldAlert = /*#__PURE__*/ wrap(PShieldWarning, 'ShieldAlert');
export const ShieldCheck = /*#__PURE__*/ wrap(PShieldCheck, 'ShieldCheck');
export const SkipForward = /*#__PURE__*/ wrap(PSkipForward, 'SkipForward');
export const Sparkles = /*#__PURE__*/ wrap(PSparkle, 'Sparkles');
export const Subtitles = /*#__PURE__*/ wrap(PSubtitles, 'Subtitles');
export const FilmSlate = /*#__PURE__*/ wrap(PFilmSlate, 'FilmSlate');
export const Sun = /*#__PURE__*/ wrap(PSun, 'Sun');
export const Trash2 = /*#__PURE__*/ wrap(PTrash, 'Trash2');
export const Type = /*#__PURE__*/ wrap(PTextAa, 'Type');
export const Undo2 = /*#__PURE__*/ wrap(PArrowUUpLeft, 'Undo2');
export const Upload = /*#__PURE__*/ wrap(PUploadSimple, 'Upload');
export const Volume1 = /*#__PURE__*/ wrap(PSpeakerLow, 'Volume1');
export const Volume2 = /*#__PURE__*/ wrap(PSpeakerHigh, 'Volume2');
export const Wand2 = /*#__PURE__*/ wrap(PMagicWand, 'Wand2');
export const X = /*#__PURE__*/ wrap(PX, 'X');
export const Zap = /*#__PURE__*/ wrap(PLightning, 'Zap');
export const Paypal = /*#__PURE__*/ wrap(PPaypalLogo, 'Paypal');
export const ArrowLeft = /*#__PURE__*/ wrap(PArrowLeft, 'ArrowLeft');
export const ArrowRight = /*#__PURE__*/ wrap(PArrowRight, 'ArrowRight');
export const Timer = /*#__PURE__*/ wrap(PTimer, 'Timer');
export const Lock = /*#__PURE__*/ wrap(PLockSimple, 'Lock');
export const SlidersHorizontal = /*#__PURE__*/ wrap(PSlidersHorizontal, 'SlidersHorizontal');
