import { Textarea } from '../../../core/ui/Field';
import { AlertIcon } from '../../../core/ui/icons';
import { decodeJwt, verdictLabel } from '../lib/jwt';
import { formatZoned, relativeTime } from '../lib/epoch';
import { useToolState } from '../useToolState';

/**
 * JWT decoding (PLAN-18). The "does not verify" line is not a disclaimer bolted
 * on at the end — it is the first thing on the panel, because a reader who
 * takes an unexpired token as a *verified* one has been actively misled.
 */
export function JwtTool() {
  const [token, setToken] = useToolState('jwt.token', '');
  const view = decodeJwt(
    token,
    Date.now(),
    (ms) => formatZoned(ms),
    (ms, now) => relativeTime(ms, now),
  );

  return (
    <>
      <p className="tool-warning" role="note">
        <AlertIcon size={16} />
        <span>
          <strong>This decodes, it does not verify.</strong> Nothing here checks the signature — no
          key ever reaches this page. An unexpired token shown below may still be forged.
        </span>
      </p>

      <Textarea
        label="Token"
        rows={4}
        spellCheck={false}
        className="field__input mono"
        placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxIn0.signature"
        value={token}
        onChange={(event) => setToken(event.target.value)}
      />

      {view.error && (
        <p className="tool-error" role="status">
          {view.error}
        </p>
      )}

      {view.header && (
        <>
          <div className="tool-bar">
            <span className={`tool-badge tool-badge--${view.verdict}`}>
              {verdictLabel(view.verdict)}
            </span>
            {view.alg && <span className="caption mono">alg: {view.alg}</span>}
            {view.typ && <span className="caption mono">typ: {view.typ}</span>}
          </div>

          <div className="tool-pair">
            <div className="field">
              <span className="field__label">Header</span>
              <pre className="tool-code mono">{view.header}</pre>
            </div>
            <div className="field">
              <span className="field__label">Payload</span>
              <pre className="tool-code mono">{view.payload}</pre>
            </div>
          </div>

          {view.times.length > 0 && (
            <dl className="tool-rows">
              {view.times.map((claim) => (
                <div className="tool-rows__row" key={claim.name}>
                  <dt>{claim.name}</dt>
                  <dd className="mono">{claim.local}</dd>
                  <span className="caption">{claim.relative}</span>
                </div>
              ))}
            </dl>
          )}

          <div className="field">
            <span className="field__label">Signature (not checked)</span>
            <pre className="tool-code mono">{view.signature || '(none — unsecured token)'}</pre>
          </div>
        </>
      )}
    </>
  );
}
