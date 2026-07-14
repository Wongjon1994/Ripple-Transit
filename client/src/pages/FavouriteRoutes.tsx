import { useState } from "react";
import { Plus, Pencil, Trash2, ArrowRight, Star } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "../lib/trpc.js";
import { Button, Input, Card, Modal, PageShell } from "../components/ui.js";
import { AddressAutocomplete } from "../components/AddressAutocomplete.js";

export function FavouriteRoutes() {
  const utils = trpc.useUtils();
  const list = trpc.favouriteRoutes.list.useQuery();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<{ id: number; label: string } | null>(
    null,
  );
  const invalidate = () => utils.favouriteRoutes.list.invalidate();

  const add = trpc.favouriteRoutes.add.useMutation({
    onSuccess: () => {
      invalidate();
      setAdding(false);
      toast.success("Route saved.");
    },
    onError: (e) => toast.error(e.message),
  });
  const rename = trpc.favouriteRoutes.rename.useMutation({
    onSuccess: () => {
      invalidate();
      setEditing(null);
      toast.success("Renamed.");
    },
    onError: (e) => toast.error(e.message),
  });
  const del = trpc.favouriteRoutes.delete.useMutation({
    onSuccess: () => {
      invalidate();
      toast.success("Deleted.");
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <PageShell
      title="Favourites"
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
          {list.data.map((r) => (
            <Card key={r.id} className="flex items-start gap-3 p-4">
              <Star size={16} className="mt-0.5 shrink-0 text-warning" />
              <div className="min-w-0 flex-1">
                <div className="font-semibold">{r.label}</div>
                <div className="flex items-center gap-1.5 truncate text-sm text-ripple-muted">
                  <span className="truncate">{r.origin}</span>
                  <ArrowRight size={12} className="shrink-0" />
                  <span className="truncate">{r.destination}</span>
                </div>
              </div>
              <div className="flex gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Rename"
                  onClick={() => setEditing({ id: r.id, label: r.label })}
                >
                  <Pencil size={15} />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Delete"
                  onClick={() => del.mutate({ id: r.id })}
                >
                  <Trash2 size={15} className="text-error" />
                </Button>
              </div>
            </Card>
          ))}
        </div>
      ) : (
        <Card className="p-8 text-center text-sm text-ripple-muted">
          No favourite routes yet. Save a trip you take often.
        </Card>
      )}

      {adding && (
        <AddRouteModal
          onClose={() => setAdding(false)}
          onSubmit={(v) => add.mutate(v)}
          pending={add.isPending}
        />
      )}
      {editing && (
        <Modal open onClose={() => setEditing(null)} title="Rename route">
          <RenameBody
            initial={editing.label}
            pending={rename.isPending}
            onSubmit={(label) => rename.mutate({ id: editing.id, label })}
          />
        </Modal>
      )}
    </PageShell>
  );
}

function AddRouteModal({
  onClose,
  onSubmit,
  pending,
}: {
  onClose: () => void;
  onSubmit: (v: { label: string; origin: string; destination: string }) => void;
  pending: boolean;
}) {
  const [label, setLabel] = useState("");
  const [origin, setOrigin] = useState("");
  const [destination, setDestination] = useState("");

  return (
    <Modal open onClose={onClose} title="Add favourite route">
      <div className="flex flex-col gap-3">
        <div>
          <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-ripple-muted">
            Label
          </label>
          <Input
            placeholder="Home to Office"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            maxLength={128}
          />
        </div>
        <div>
          <label className="mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-ripple-muted">
            <span className="h-2 w-2 rounded-full bg-bus" /> Origin
          </label>
          <AddressAutocomplete
            value={origin}
            onChange={setOrigin}
            onSelect={(r) => setOrigin(r.title)}
          />
        </div>
        <div>
          <label className="mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-ripple-muted">
            <span className="h-2 w-2 rounded-full bg-mrt" /> Destination
          </label>
          <AddressAutocomplete
            value={destination}
            onChange={setDestination}
            onSelect={(r) => setDestination(r.title)}
          />
        </div>
        <Button
          variant="accent"
          disabled={pending}
          onClick={() => {
            if (!label.trim() || !origin.trim() || !destination.trim())
              return toast.error("Fill in all fields.");
            onSubmit({
              label: label.trim(),
              origin: origin.trim(),
              destination: destination.trim(),
            });
          }}
        >
          Save route
        </Button>
      </div>
    </Modal>
  );
}

function RenameBody({
  initial,
  onSubmit,
  pending,
}: {
  initial: string;
  onSubmit: (label: string) => void;
  pending: boolean;
}) {
  const [label, setLabel] = useState(initial);
  return (
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
  );
}
