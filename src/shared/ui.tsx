import { themeVariables } from './theme.js';
export { themeVariables } from './theme.js';
import type { ReactNode } from 'react';
import {
  Cloud, GitBranch, FolderUp, KeyRound, Activity, ShieldCheck,
  Share2,
  Ellipsis,
  ScanLine,
  Minimize2,
  ArrowUpToLine,
  ArrowDownToLine,
  ChevronUp,
  QrCode,
  Printer,
  Quote,
  ArrowUpRight,
  ArrowRight,
  Search,
  SunMoon,
  Sun,
  Moon,
  Menu,
  X,
  ChevronRight,
  ChevronLeft,
  Import,
  Undo2,
  Tags,
  ChevronDown,
  ChevronsUpDown,
  BookOpen,
  FlaskConical,
  Image,
  Radio,
  Home,
  Settings2,
  PanelLeftClose,
  Plus,
  Upload,
  Play,
  Check,
  CheckCheck,
  CloudUpload,
  Circle,
  FileText,
  Trash2,
  RotateCcw,
  Code2,
  Wrench,
  WrapText,
  Smile,
  Eye,
  EyeOff,
  LockKeyhole,
  Info,
  ExternalLink,
  Monitor,
  Smartphone,
  Maximize2,
  SlidersHorizontal,
  Sparkles,
  MapPin,
  Pin,
  Mail,
  Rss,
  CircleHelp,
  Copy,
  Save,
  AlertCircle,
  LoaderCircle,
  Layers,
  GripVertical,
  ArrowUp,
  ArrowDown,
  FolderOpen,
  Palette,
  CheckCircle2,
  LogOut,
  Link as LinkIcon,
  Archive,
  CalendarDays,
  Clock3,
  Languages,
  Hash,
  FunctionSquare,
  ChartNoAxesCombined,
  Columns2,
  Table2,
  MoveHorizontal,
  Workflow,
  Bold,
  AlignLeft,
  AlignCenter,
  AlignRight,
  Italic,
  Heading2,
  PenLine,
  ListTree,
  History,
  Download,
  HardDrive,
  Expand,
  UserRound,
  Crop,
  MessageCircle,
  ZoomIn,
  ZoomOut,
  Globe,
  type LucideProps,
} from 'lucide-react';
import type { SiteConfig } from './contracts.js';

function GithubMark({ size = 18, className = '', ...props }: LucideProps) {
  return (
    <svg
      {...props}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      className={`lucide lucide-github ${className}`}
      fill="currentColor"
      stroke="none"
    >
      <path d="M12 .75a11.25 11.25 0 0 0-3.558 21.923c.563.104.77-.244.77-.542v-2.094c-3.13.68-3.79-1.328-3.79-1.328-.512-1.3-1.25-1.647-1.25-1.647-1.022-.7.077-.686.077-.686 1.13.08 1.725 1.16 1.725 1.16 1.005 1.723 2.637 1.225 3.28.936.102-.728.393-1.225.715-1.506-2.498-.284-5.124-1.25-5.124-5.563 0-1.229.44-2.233 1.16-3.02-.116-.285-.503-1.43.11-2.98 0 0 .945-.303 3.094 1.154a10.79 10.79 0 0 1 5.632 0c2.148-1.457 3.091-1.154 3.091-1.154.615 1.55.228 2.695.112 2.98.722.787 1.159 1.791 1.159 3.02 0 4.324-2.63 5.276-5.136 5.554.404.35.764 1.042.764 2.1v3.124c0 .3.203.651.774.541A11.25 11.25 0 0 0 12 .75Z" />
    </svg>
  );
}
const icons = {
  Cloud, GitBranch, FolderUp, KeyRound, Activity, ShieldCheck,
  Share2,
  Ellipsis,
  ScanLine,
  Minimize2,
  ArrowUpToLine,
  ArrowDownToLine,
  ChevronUp,
  QrCode,
  Printer,
  Quote,
  ArrowUpRight,
  ArrowRight,
  Search,
  SunMoon,
  Sun,
  Moon,
  Menu,
  X,
  ChevronRight,
  ChevronLeft,
  Import,
  Undo2,
  Tags,
  ChevronDown,
  ChevronsUpDown,
  BookOpen,
  FlaskConical,
  Image,
  Radio,
  Home,
  Settings2,
  PanelLeftClose,
  Plus,
  Upload,
  Play,
  Check,
  CheckCheck,
  CloudUpload,
  Circle,
  FileText,
  Trash2,
  RotateCcw,
  Code2,
  Wrench,
  WrapText,
  Smile,
  Eye,
  EyeOff,
  LockKeyhole,
  Info,
  ExternalLink,
  Monitor,
  Smartphone,
  Maximize2,
  SlidersHorizontal,
  Sparkles,
  MapPin,
  Pin,
  Github: GithubMark,
  Globe,
  Mail,
  Rss,
  CircleHelp,
  Copy,
  Save,
  AlertCircle,
  LoaderCircle,
  Layers,
  GripVertical,
  ArrowUp,
  ArrowDown,
  FolderOpen,
  Palette,
  CheckCircle2,
  LogOut,
  LinkIcon,
  Archive,
  CalendarDays,
  Clock3,
  Languages,
  Hash,
  FunctionSquare,
  ChartNoAxesCombined,
  Columns2,
  Table2,
  MoveHorizontal,
  Workflow,
  Bold,
  AlignLeft,
  AlignCenter,
  AlignRight,
  Italic,
  Heading2,
  PenLine,
  ListTree,
  History,
  Download,
  HardDrive,
  Expand,
  UserRound,
  Crop,
  MessageCircle,
  ZoomIn,
  ZoomOut,
};
export type IconName = keyof typeof icons;
export function socialIconFor(href: string): IconName {
  if (href.startsWith('mailto:')) return 'Mail';
  try {
    const url = new URL(href, 'https://local.invalid');
    if (
      url.hostname.toLowerCase() === 'github.com' ||
      url.hostname.toLowerCase().endsWith('.github.com')
    )
      return 'Github';
    if (/\/(?:feed|rss)(?:\.xml)?\/?$/i.test(url.pathname)) return 'Rss';
    return url.hostname === 'local.invalid' ? 'LinkIcon' : 'Globe';
  } catch {
    return 'LinkIcon';
  }
}
const navigationIcons: Record<string, IconName> = {
  '': 'Home',
  blog: 'BookOpen',
  lab: 'FlaskConical',
  life: 'Image',
  archive: 'Archive',
  about: 'UserRound',
};
export function navigationIconFor(href: string): IconName {
  if (href === '/projects/') return 'Code2';
  return href.startsWith('/') ? navigationIcons[href.split('/')[1]] || 'LinkIcon' : 'LinkIcon';
}
export function Icon({
  name,
  size = 18,
  ...rest
}: {
  name: IconName;
  size?: number;
  className?: string;
  'aria-hidden'?: boolean;
}) {
  const Component = icons[name];
  return <Component size={size} strokeWidth={1.65} aria-hidden="true" {...rest} />;
}
export function Brand({
  name = 'Glass',
  compact = false,
  logo = '',
  darkLogo = '',
  showName = true,
  namePeriod = true,
  appearance = 'system',
}: {
  name?: string;
  compact?: boolean;
  logo?: string;
  darkLogo?: string;
  showName?: boolean;
  namePeriod?: boolean;
  appearance?: 'light' | 'dark' | 'system';
}) {
  return (
    <span className="brand">
      <span className={`brand-mark${logo ? ' brand-mark-image' : ''}`} aria-hidden="true">
        {logo ? (
          <picture>
            {darkLogo && (
              <source
                data-brand-dark
                srcSet={darkLogo}
                media={
                  appearance === 'system'
                    ? '(prefers-color-scheme: dark)'
                    : appearance === 'dark'
                      ? 'all'
                      : 'not all'
                }
              />
            )}
            <img src={logo} alt="" width="32" height="32" decoding="async" />
          </picture>
        ) : (
          <svg viewBox="0 0 32 32">
            <path
              d="M8 8.5C12 5 20 5 24 8.5V24c-4-3.5-12-3.5-16 0Z"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
            />
            <path
              d="M16 6v15M11 11l3-1M19 10l3 1M11 15l3-1M19 14l3 1"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.3"
              strokeLinecap="round"
            />
          </svg>
        )}
      </span>
      {!compact && showName && (
        <span>
          {name}
          {namePeriod && <span className="brand-period">.</span>}
        </span>
      )}
    </span>
  );
}
export function Button({
  children,
  icon,
  variant = 'secondary',
  className = '',
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  icon?: IconName;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
}) {
  return (
    <button {...props} className={`button ${variant} ${className}`}>
      {icon && <Icon name={icon} />} {children}
    </button>
  );
}
export function EmptyState({
  icon = 'BookOpen',
  title,
  children,
}: {
  icon?: IconName;
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="empty-state">
      <span className="empty-icon">
        <Icon name={icon} size={26} />
      </span>
      <h3>{title}</h3>
      <p>{children}</p>
    </div>
  );
}
export function ThemeStyle({ theme }: { theme: SiteConfig['theme'] }) {
  const vars = Object.entries(themeVariables(theme))
    .map(([key, value]) => `${key}:${value}`)
    .join(';');
  return <style>{`:root{${vars}}`}</style>;
}
