import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Button } from '../../core/ui/Button';
import { renderMarkdown, outline } from '../../core/markdown';
import { fetchEdda, type EddaDoc } from '../../core/edda';
import { MarkdownPreview } from './MarkdownPreview';

type Phase = 'loading' | 'ready' | 'notfound' | 'error';

/**
 * Public read-only rendered page (owner spec — "preview" literally in the path).
 * Clean typography, theme-styled, outline in a side rail on desktop, and an
 * "Open in editor" affordance. No chrome beyond that.
 */
export function EddaPreviewPage() {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const [phase, setPhase] = useState<Phase>('loading');
  const [doc, setDoc] = useState<EddaDoc | null>(null);

  useEffect(() => {
    if (!slug) return;
    let cancelled = false;
    setPhase('loading');
    fetchEdda(slug)
      .then((found) => {
        if (cancelled) return;
        if (!found) {
          setPhase('notfound');
          return;
        }
        setDoc(found);
        setPhase('ready');
        if (found.slug !== slug) navigate(`/edda/preview/${found.slug}`, { replace: true });
      })
      .catch(() => {
        if (!cancelled) setPhase('error');
      });
    return () => {
      cancelled = true;
    };
  }, [slug]);

  const html = useMemo(() => (doc ? renderMarkdown(doc.content) : ''), [doc]);
  const headings = useMemo(() => (doc ? outline(doc.content) : []), [doc]);

  if (phase === 'loading') {
    return <div className="page-loading caption">Opening the manuscript…</div>;
  }

  if (phase === 'notfound' || phase === 'error') {
    return (
      <div className="page-head">
        <div>
          <span className="eyebrow eyebrow--amber">the eddas</span>
          <h2>{phase === 'notfound' ? 'This edda was never written' : 'Could not open this edda'}</h2>
          <p>
            <Link to="/edda/pensieve">Back to the Pensieve</Link>
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="edda-read">
      <div className="edda-read__head">
        <div>
          <span className="eyebrow eyebrow--amber">the eddas · a manuscript to read</span>
          <h1 className="edda-read__title">{doc?.name}</h1>
        </div>
        <Button variant="ghost" onClick={() => void navigate(`/edda/${doc?.slug ?? ''}`)}>
          Open in editor
        </Button>
      </div>
      <div className="edda-read__body">
        {headings.length > 0 && (
          <nav className="edda-read__outline" aria-label="Contents">
            <p className="caption">Contents</p>
            <ul>
              {headings.map((heading, index) => (
                <li
                  key={`${heading.id}-${index}`}
                  style={{ paddingLeft: `${(heading.depth - 1) * 0.75}rem` }}
                >
                  <a href={`#${heading.id}`}>{heading.text || '(untitled)'}</a>
                </li>
              ))}
            </ul>
          </nav>
        )}
        <MarkdownPreview html={html} className="md-preview--read" />
      </div>
    </div>
  );
}
