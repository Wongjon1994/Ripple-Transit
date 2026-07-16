import { useState } from "react";
import { Plus, Pencil, Trash2, MapPin } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "../lib/trpc.js";
import { Button, Input, Card, Modal, PageShell } from "../components/ui.js";
import { AddressAutocomplete } from "../components/AddressAutocomplete.js";
import type { SearchResult } from "@shared/types.js";

export function SavedLocations() {
  const utils = trpc.useUtils();
  const list = trpc.savedLocations.list.useQuery();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<{ id: number; label: string } | null>(
    null,
  );

  const invalidate = () => utils.savedLocations.list.invalidate();

  const add = trpc.savedLocations.add.useMutation({
    onSuccess: () => {
      invalidate();
      setAdding(false);
      toast.success("Location saved.");
    },
    onError: (e) => toast.error(e.message),
  });
  const rename = trpc.savedLocations.rename.useMutation({
    onSuccess: () => {
      invalidate();
      setEditing(null);
      toast.success("Renamed.");
    },
    onError: (e) => toast.error(e.message),
  });
  const del = trpc.savedLocations.delete.useMutation({
    onSuccess: () => {
      invalidate();
      toast.success("Deleted.");
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <PageShell
      title="Places"
      action={
        <Button size="sm" variant="accent" onClick={() => setAdding(true)}>
          <Plus size={15} /> Add
        </Button>
      }
    >
      {list.isLoading ? (
        <p className="text-sm text-ripple-muted">Loading…</p>
      ) : list.data && list.data.length > 0 ? (
        <div className="flex flex-col gap-2">
          {list.data.map((loc) => (
            <Card key={loc.id} className="flex items-start gap-3 p-4">
              <MapPin size={16} className="mt-0.5 shrink-0 text-brand" />
              <div className="min-w-0 flex-1">
                <div className="font-semibold">{loc.label}</div>
                <div className="truncate text-sm text-ripple-muted">
                  {loc.address}
                </div>
              </div>
              <div className="flex gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Rename"
                  onClick={() =>
                    setEditing({ id: loc.id, label: loc.label })
                  }
                >
                  <Pencil size={15} />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Delete"
                  onClick={() => del.mutate({ id: loc.id })}
                >
                  <Trash2 size={15} className="text-error" />
                </Button>
              </div>
            </Card>
          ))}
        </div>
      ) : (
        <Card className="p-8 text-center text-sm text-ripple-muted">
          No saved locations yet. Add your home, office, or a frequent spot.
        </Card>
      )}

      {adding && (
        <AddLocationModal
          onClose={() => setAdding(false)}
          onSubmit={(v) => add.mutate(v)}
          pending={add.isPending}
        />
      )}

      {editing && (
        <RenameModal
          initial={editing.label}
          onClose={() => setEditing(null)}
          onSubmit={(label) => rename.mutate({ id: editing.id, label })}
          pending={rename.isPending}
        />
      )}
    </PageShell>
  );
}

function AddLocationModal({
  onClose,
  onSubmit,
  pending,
}: {
  onClose: () => void;
  onSubmit: (v: {
    label: string;
    address: string;
    lat: string;
    lng: string;
  }) => void;
  pending: boolean;
}) {
  const [label, setLabel] = useState("");
  const [addrText, setAddrText] = useState("");
  const [picked, setPicked] = useState<SearchResult | null>(null);

  return (
    <Modal open onClose={onClose} title="Add saved location">
      <div className="flex flex-col gap-3">
        <div>
          <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-ripple-muted">
            Label
          </label>
          <Input
            placeholder="Home, Office, Gym…"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            maxLength={128}
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-ripple-muted">
            Address
          </label>
          <AddressAutocomplete
            value={addrText}
            onChange={(t) => {
              setAddrText(t);
              setPicked(null);
            }}
            onSelect={(r) => {
              setPicked(r);
              setAddrText(r.address);
            }}
          />
          {picked && (
            <p className="mt-1 text-xs text-ok">✓ Location pinned</p>
          )}
        </div>
        <Button
          variant="accent"
          disabled={pending}
          onClick={() => {
            if (!label.trim()) return toast.error("Enter a label.");
            if (!picked) return toast.error("Pick an address from the list.");
            onSubmit({
              label: label.trim(),
              address: picked.address,
              lat: String(picked.lat),
              lng: String(picked.lng),
            });
          }}
        >
          Save location
        </Button>
      </div>
    </Modal>
  );
}

function RenameModal({
  initial,
  onClose,
  onSubmit,
  pending,
}: {
  initial: string;
  onClose: () => void;
  onSubmit: (label: string) => void;
  pending: boolean;
}) {
  const [label, setLabel] = useState(initial);
  return (
    <Modal open onClose={onClose} title="Rename">
      <div className="flex flex-col gap-3">
        <Input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          maxLength={128}
          autoFocus
        />
        <Button
          variant="accent"
          disabled={pending}
          onClick={() => label.trim() && onSubmit(label.trim())}
        >
          Save
        </Button>
      </div>
    </Modal>
  );
}
