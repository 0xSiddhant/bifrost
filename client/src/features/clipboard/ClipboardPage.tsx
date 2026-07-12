import { Button } from '../../core/ui/Button';
import { Card } from '../../core/ui/Card';
import { ClipboardIcon } from '../../core/ui/icons';

/** Static design shell — real sync lands in PLAN-06. */

const MOCK_HISTORY = [
  { text: 'https://example.com/that-article-i-wanted-on-my-phone', device: 'MacBook', time: '4m ago' },
  { text: 'WPA key: correct-horse-battery-staple', device: 'iPhone', time: '1h ago' },
  { text: 'meet at 7 by the north entrance', device: 'Pixel', time: 'yesterday' },
];

export function ClipboardPage() {
  return (
    <>
      <div className="page-head">
        <div>
          <span className="eyebrow">huginn &amp; muninn · the ravens carry words</span>
          <h2>Clipboard</h2>
          <p>Paste once, read everywhere. Text syncs to every connected device.</p>
        </div>
      </div>

      <div className="stack">
        <Card>
          <div className="stack">
            <div className="field">
              <label className="field__label" htmlFor="clip-input">
                Shared clipboard
              </label>
              <textarea
                id="clip-input"
                className="field__input"
                rows={4}
                placeholder="Type or paste text to share it with every device…"
                defaultValue="https://example.com/that-article-i-wanted-on-my-phone"
              />
            </div>
            <div className="row">
              <Button>
                <ClipboardIcon size={16} /> Copy
              </Button>
              <Button variant="ghost">Send to devices</Button>
            </div>
          </div>
        </Card>

        <h3>History</h3>
        <Card>
          {MOCK_HISTORY.map((item) => (
            <div className="file-row" key={item.text}>
              <div className="file-row__body">
                <div className="file-row__name">{item.text}</div>
                <div className="file-row__meta">
                  <span>from {item.device}</span>
                  <span>{item.time}</span>
                </div>
              </div>
              <div className="file-row__aside">
                <Button variant="ghost" size="sm">
                  Copy
                </Button>
              </div>
            </div>
          ))}
        </Card>
      </div>
    </>
  );
}
