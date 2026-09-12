import { Suspense, useEffect, useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useCapabilities } from '../../core/useCapabilities';
import { ExpandingGrid } from '../../core/ui/ExpandingGrid';
import { LazyToolBody, TOOLS, availableTools } from '../../features/toolbox';

/**
 * Diagon Alley — the utility toolbox itself, not a row of doors to one (PLAN-18).
 * Small pure-client tools open **in place**: a full-width panel at the end of
 * the source card's row. Nimbus and Portkey own real state and a server module,
 * so their cards still navigate to their own pages.
 *
 * The open tool lives in the URL (`/diagon-alley/:toolId`), which makes Back
 * close the panel, refresh reopen it, and a tool linkable.
 *
 * Card colour follows **position** in the registry (see cardToneClass): reorder
 * TOOLS and the colours reorder with them — nothing hardcodes a per-card hue.
 */
export function DiagonAlleyPage() {
  const { capabilities } = useCapabilities();
  const { toolId } = useParams();
  const navigate = useNavigate();

  const tools = useMemo(
    () =>
      availableTools(TOOLS, (module) => !capabilities || capabilities.modules.includes(module)),
    [capabilities],
  );

  const openTool = tools.find((tool) => tool.id === toolId && !tool.to) ?? null;

  /**
   * An unknown, unavailable or unsupported :toolId renders the hub with nothing
   * open and rewrites the URL — never a 404, never a dead panel. Replaced, not
   * pushed, so Back doesn't bounce straight back into the bad URL. Waits for
   * capabilities: until they land every tool looks available, and redirecting
   * on a half-loaded page would close a panel the user legitimately deep-linked.
   */
  useEffect(() => {
    if (!toolId || !capabilities) return;
    if (openTool) return;
    navigate('/diagon-alley', { replace: true });
  }, [toolId, capabilities, openTool, navigate]);

  return (
    <>
      <div className="page-head">
        <div>
          <span className="eyebrow eyebrow--violet">diagon alley · little shops of handy magic</span>
          <h2>Diagon Alley</h2>
          <p>
            Small, self-contained tools that run entirely in this browser. Tap one and it opens
            right here.
          </p>
        </div>
      </div>

      <ExpandingGrid
        label="Toolbox"
        items={tools}
        openId={openTool?.id ?? null}
        onOpen={(id) => navigate(`/diagon-alley/${id}`)}
        onClose={() => navigate('/diagon-alley')}
      >
        {openTool && (
          <Suspense fallback={<ToolSkeleton />}>
            <LazyToolBody toolId={openTool.id} />
          </Suspense>
        )}
      </ExpandingGrid>
    </>
  );
}

/** A visible shape while the tool chunk arrives — never a blank panel. */
function ToolSkeleton() {
  return (
    <div className="tool-skeleton" role="status" aria-label="Opening the tool">
      <span className="tool-skeleton__bar" />
      <span className="tool-skeleton__bar" />
      <span className="tool-skeleton__bar" />
    </div>
  );
}
