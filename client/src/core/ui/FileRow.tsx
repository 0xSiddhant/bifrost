import type { ReactNode } from 'react';
import {
  ArchiveFileIcon,
  AudioFileIcon,
  DocFileIcon,
  FileIcon,
  ImageFileIcon,
  VideoFileIcon,
} from './icons';

export type FileKind = 'image' | 'video' | 'archive' | 'doc' | 'audio' | 'other';

const KIND_ICONS: Record<FileKind, ReactNode> = {
  image: <ImageFileIcon />,
  video: <VideoFileIcon />,
  archive: <ArchiveFileIcon />,
  doc: <DocFileIcon />,
  audio: <AudioFileIcon />,
  other: <FileIcon />,
};

export function kindOf(name: string): FileKind {
  const ext = name.toLowerCase().split('.').pop() ?? '';
  if (['png', 'jpg', 'jpeg', 'heic', 'webp', 'gif', 'svg'].includes(ext)) return 'image';
  if (['mp4', 'mov', 'mkv', 'webm'].includes(ext)) return 'video';
  if (['zip', 'tar', 'gz', 'rar', '7z'].includes(ext)) return 'archive';
  if (['pdf', 'md', 'txt', 'doc', 'docx', 'pages'].includes(ext)) return 'doc';
  if (['mp3', 'm4a', 'wav', 'flac'].includes(ext)) return 'audio';
  return 'other';
}

interface FileRowProps {
  name: string;
  size: string;
  time: string;
  aside?: ReactNode;
  children?: ReactNode;
}

export function FileRow({ name, size, time, aside, children }: FileRowProps) {
  const kind = kindOf(name);
  return (
    <div className="file-row">
      <span className={`file-row__icon file-row__icon--${kind}`}>{KIND_ICONS[kind]}</span>
      <div className="file-row__body">
        <div className="file-row__name">{name}</div>
        <div className="file-row__meta">
          <span>{size}</span>
          <span>{time}</span>
        </div>
        {children}
      </div>
      {aside && <div className="file-row__aside">{aside}</div>}
    </div>
  );
}
