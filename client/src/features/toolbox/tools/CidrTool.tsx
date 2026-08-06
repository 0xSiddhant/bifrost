import { Input } from '../../../core/ui/Field';
import { copyText } from '../../../core/copy';
import { notify } from '../../../core/notify';
import { contains, parseCidr } from '../lib/cidr';
import { useToolState } from '../useToolState';

/** IPv4 CIDR maths (PLAN-18) — the numbers a router's config page asks for. */
export function CidrTool() {
  const [input, setInput] = useToolState('cidr.input', '192.168.1.0/24');
  const [probe, setProbe] = useToolState('cidr.probe', '');
  const info = parseCidr(input);
  const inside = info && probe.trim() ? contains(info, probe) : null;

  const copy = async (value: string) => {
    if (await copyText(value)) notify.ok('Copied');
    else notify.error('Could not reach the clipboard — select the value and copy it by hand.');
  };

  return (
    <>
      <div className="tool-controls">
        <Input
          label="Block"
          spellCheck={false}
          className="field__input mono"
          placeholder="192.168.1.0/24"
          value={input}
          onChange={(event) => setInput(event.target.value)}
        />
        {info && (
          <p className="caption">
            {info.scope === 'public'
              ? 'A public block — these addresses are routable on the internet.'
              : `A ${info.scope} block.`}
            {info.note ? ` ${info.note}` : ''}
          </p>
        )}

        <Input
          label="Is this address inside?"
          spellCheck={false}
          className="field__input mono"
          placeholder="192.168.1.33"
          value={probe}
          onChange={(event) => setProbe(event.target.value)}
        />
        {probe.trim() !== '' && (
          <p className={inside === null ? 'tool-error' : 'caption'} role="status">
            {inside === null
              ? 'That is not a valid IPv4 address.'
              : inside
                ? `Yes — ${probe.trim()} is inside ${info?.cidr}.`
                : `No — ${probe.trim()} is outside ${info?.cidr}.`}
          </p>
        )}
      </div>

      <div className="tool-output">
        {info ? (
          <dl className="tool-rows">
            {(
              [
                ['Network', info.network],
                ['Broadcast', info.broadcast],
                ['Netmask', info.mask],
                ['Wildcard', info.wildcard],
                ['First host', info.firstHost],
                ['Last host', info.lastHost],
                ['Addresses', info.totalAddresses.toLocaleString()],
                ['Usable hosts', info.usableHosts.toLocaleString()],
              ] as Array<[string, string]>
            ).map(([label, value]) => (
              <div className="tool-rows__row" key={label}>
                <dt>{label}</dt>
                <dd className="mono">{value}</dd>
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  onClick={() => copy(value)}
                  aria-label={`Copy ${label}`}
                >
                  Copy
                </button>
              </div>
            ))}
          </dl>
        ) : (
          <p className={input.trim() === '' ? 'caption' : 'tool-error'} role="status">
            {input.trim() === ''
              ? 'Type a block like 192.168.1.0/24. A bare address is read as /32.'
              : 'That is not a valid IPv4 block — try 192.168.1.0/24.'}
          </p>
        )}
      </div>
    </>
  );
}
