"use client";
// Edit a household recipe (UX-4 "Admin: edit"; leaf-1.4.4 SPEC-Q-10): the dish's own fields as
// one `dish.update` change set. Components, ingredients and steps are changed by the assistant
// ("Ask assistant to revise"): the API does not return every stored variant field (yield
// overrides), so a component tree written from here would lose data.
import { useId, useState } from "react";
import { Button, Sheet } from "../ui";
import { applyChanges, problemText, type Dish, type Slot } from "../plan/api";

export function EditSheet({
  dish,
  slots,
  onSaved,
}: {
  readonly dish: Dish;
  readonly slots: readonly Slot[];
  readonly onSaved: () => void;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(dish.name);
  const [description, setDescription] = useState(dish.description);
  const [tags, setTags] = useState(dish.flavourTags.join(", "));
  const [packable, setPackable] = useState(dish.isPackable);
  const [cold, setCold] = useState(dish.servedColdOk);
  const [slotKeys, setSlotKeys] = useState<string[]>(dish.slotKeys);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const flavourTags = tags
        .split(",")
        .map((t) => t.trim())
        .filter((t) => t !== "");
      await applyChanges(`Edit ${name.trim()}`, [
        {
          kind: "dish.update",
          payload: {
            dishId: dish.id,
            name: name.trim(),
            description: description.trim(),
            flavourTags,
            isPackable: packable,
            servedColdOk: cold,
            slotKeys,
          },
        },
      ]);
      setOpen(false);
      onSaved();
    } catch (e) {
      setError(problemText(e));
    } finally {
      setBusy(false);
    }
  };
  const field = "min-h-11 rounded-md border-[1.5px] border-line-strong bg-card px-3 text-ink";
  return (
    <Sheet
      open={open}
      onOpenChange={setOpen}
      trigger={<Button variant="secondary">Edit</Button>}
      title={`Edit ${dish.name}`}
      description="Name, description, tags and which meals it suits. To change ingredients or steps, ask the assistant to revise it."
      footer={
        <>
          <Button
            variant="secondary"
            onClick={() => {
              setOpen(false);
            }}
          >
            Cancel
          </Button>
          <Button
            loading={busy}
            disabled={name.trim() === "" || slotKeys.length === 0}
            onClick={() => void save()}
          >
            Save
          </Button>
        </>
      }
    >
      <label htmlFor={`${id}-name`} className="font-extrabold">
        Name
      </label>
      <input
        id={`${id}-name`}
        value={name}
        maxLength={120}
        onChange={(e) => {
          setName(e.target.value);
        }}
        className={field}
      />
      <label htmlFor={`${id}-desc`} className="font-extrabold">
        Description
      </label>
      <textarea
        id={`${id}-desc`}
        value={description}
        maxLength={2000}
        rows={3}
        onChange={(e) => {
          setDescription(e.target.value);
        }}
        className={`${field} py-2`}
      />
      <label htmlFor={`${id}-tags`} className="font-extrabold">
        Flavour tags <span className="font-normal text-ink-muted">(comma separated)</span>
      </label>
      <input
        id={`${id}-tags`}
        value={tags}
        onChange={(e) => {
          setTags(e.target.value);
        }}
        className={field}
      />
      <fieldset className="m-0 flex flex-col gap-1.5 border-0 p-0">
        <legend className="mb-1.5 font-extrabold">Suits these meals</legend>
        <div className="flex flex-wrap gap-1.5">
          {slots.map((s) => {
            const on = slotKeys.includes(s.key);
            return (
              <button
                key={s.id}
                type="button"
                aria-pressed={on}
                onClick={() => {
                  setSlotKeys(on ? slotKeys.filter((k) => k !== s.key) : [...slotKeys, s.key]);
                }}
                className={`min-h-11 rounded-full px-3 text-sm font-extrabold ${on ? "bg-ink text-paper" : "bg-flour text-ink"}`}
              >
                {s.label}
              </button>
            );
          })}
        </div>
      </fieldset>
      <label className="flex min-h-11 items-center gap-2.5">
        <input
          type="checkbox"
          checked={packable}
          onChange={(e) => {
            setPackable(e.target.checked);
          }}
          className="size-5 accent-basil"
        />
        Packable (lunch boxes)
      </label>
      <label className="flex min-h-11 items-center gap-2.5">
        <input
          type="checkbox"
          checked={cold}
          onChange={(e) => {
            setCold(e.target.checked);
          }}
          className="size-5 accent-basil"
        />
        Fine served cold
      </label>
      {error !== null && (
        <p role="alert" className="m-0 text-sm font-bold text-pomegranate-text">
          {error}
        </p>
      )}
    </Sheet>
  );
}
