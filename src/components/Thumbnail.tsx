import { colorFilter, type ColorAdjustments } from '../domain/visual';
import { useState } from 'react';
import { Film } from 'lucide-react';

export function Thumbnail({
  src,
  alt = '',
  className = '',
  colorAdjustments,
}: {
  src?: string;
  alt?: string;
  className?: string;
  colorAdjustments?: ColorAdjustments | null;
}) {
  const [failedSrc, setFailedSrc] = useState<string>();
  return (
    <div className={`thumbnail ${className}`}>
      {src && failedSrc !== src ? (
        <img
          src={src}
          style={{ filter: colorFilter(colorAdjustments) }}
          alt={alt}
          loading="lazy"
          decoding="async"
          onError={() => setFailedSrc(src)}
        />
      ) : (
        <div
          className="thumbnail-placeholder"
          role={alt ? 'img' : undefined}
          aria-label={alt || undefined}
        >
          <Film size={28} strokeWidth={1.2} />
          <span>SHIORI</span>
        </div>
      )}
    </div>
  );
}
