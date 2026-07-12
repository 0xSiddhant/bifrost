import { useNavigate } from 'react-router-dom';
import { Button } from '../../core/ui/Button';
import { EmptyState } from '../../core/ui/EmptyState';
import { FolderIcon } from '../../core/ui/icons';

export function NotFoundPage() {
  const navigate = useNavigate();
  return (
    <EmptyState
      icon={<FolderIcon size={28} />}
      title="404 — off the bridge"
      hint="This realm doesn't exist. Heimdall has no record of it."
      action={
        <Button variant="ghost" onClick={() => navigate('/')}>
          Back to Midgard
        </Button>
      }
    />
  );
}
